import os
import transcriber
import summarizer
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
import logging
from logging.handlers import RotatingFileHandler
import traceback
from datetime import datetime

# --- Configuration ---
TRANSCRIBE_DIR = "transcribe"
SUMMARY_DIR = "summary"
VIDEOS_DIR = "videos"
LOGS_DIR = "logs"

# Allowed file extensions
ALLOWED_EXTENSIONS = {'webm', 'ogg', 'mp4', 'wav', 'mp3', 'm4a', 'flac'}

# Maximum file size: 500MB
MAX_FILE_SIZE = 500 * 1024 * 1024

# Create directories if they don't exist
for directory in [TRANSCRIBE_DIR, SUMMARY_DIR, VIDEOS_DIR, LOGS_DIR]:
    os.makedirs(directory, exist_ok=True)

# --- Flask Server Setup ---
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["http://127.0.0.1:*", "http://localhost:*"]}})

# Configure request size
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# --- Logging Configuration ---
def setup_logging():
    """Configure comprehensive logging"""
    log_file = os.path.join(LOGS_DIR, f'server_{datetime.now().strftime("%Y%m%d")}.log')
    
    # Create formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # File handler with rotation
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=10*1024*1024,  # 10MB
        backupCount=5
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.INFO)
    
    # Configure root logger
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

logger = setup_logging()

# --- Helper Functions ---
def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def create_output_paths(audio_filename):
    """
    Creates full paths for the transcript and summary files
    based on the input audio filename.
    """
    # Get the base filename without extension
    base_name = os.path.splitext(os.path.basename(audio_filename))[0]
    
    # Create timestamped filenames for uniqueness
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Create the new filenames
    transcript_filename = f"{base_name}_transcript_{timestamp}.txt"
    summary_filename = f"{base_name}_summary_{timestamp}.txt"
    
    # Create the full paths
    transcript_full_path = os.path.join(TRANSCRIBE_DIR, transcript_filename)
    summary_full_path = os.path.join(SUMMARY_DIR, summary_filename)
    
    logger.info(f"Transcript path: {transcript_full_path}")
    logger.info(f"Summary path: {summary_full_path}")
    
    return transcript_full_path, summary_full_path

def validate_file_size(file):
    """Validate file size before processing"""
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)
    
    if file_size == 0:
        raise ValueError("File is empty")
    
    if file_size > MAX_FILE_SIZE:
        raise ValueError(f"File too large. Maximum size is {MAX_FILE_SIZE / (1024*1024):.0f}MB")
    
    return file_size

# --- API Endpoints ---
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "Local AI Recorder Backend",
        "timestamp": datetime.now().isoformat()
    }), 200

@app.route('/upload', methods=['POST'])
def upload_and_process():
    """Main endpoint for uploading and processing audio files"""
    logger.info("=" * 60)
    logger.info("New request received...")
    
    start_time = datetime.now()

    try:
        # Validate request
        if 'audio' not in request.files:
            logger.warning("No 'audio' file in request")
            return jsonify({"error": "No audio file provided"}), 400

        file = request.files['audio']
        
        if file.filename == '':
            logger.warning("No selected file")
            return jsonify({"error": "No file selected"}), 400
        
        # Validate file extension
        if not allowed_file(file.filename):
            logger.warning(f"Invalid file type: {file.filename}")
            return jsonify({
                "error": f"Invalid file type. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
            }), 400

        # Validate file size
        try:
            file_size = validate_file_size(file)
            logger.info(f"File size: {file_size / (1024*1024):.2f}MB")
        except ValueError as e:
            logger.error(f"File validation error: {e}")
            return jsonify({"error": str(e)}), 400

        # Sanitize filename
        filename = secure_filename(file.filename)
        if not filename:
            filename = f"recording_{datetime.now().strftime('%Y%m%d_%H%M%S')}.webm"
        
        # Save the audio file
        audio_save_path = os.path.join(VIDEOS_DIR, filename)
        file.save(audio_save_path)
        logger.info(f"Audio saved to: {audio_save_path}")
        
        # Generate output file paths
        transcript_file, summary_file = create_output_paths(filename)
        
        # Process the audio
        logger.info(f"Processing '{filename}'...")
        
        # Step 1: Transcribe with speaker diarization
        logger.info("Starting transcription with speaker diarization...")
        transcription_result = transcriber.transcribe(audio_save_path, transcript_file)
        logger.info(f"Transcript saved: {transcript_file}")

        # Step 2: Summarize
        logger.info("Generating summary...")
        summary_result = summarizer.summarize(transcript_file, summary_file)
        logger.info(f"Summary saved: {summary_file}")

        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"Processing complete in {processing_time:.2f} seconds")
        logger.info("=" * 60)

        return jsonify({
            "success": True,
            "message": "Processing completed successfully",
            "data": {
                "audio_file": filename,
                "transcript_path": transcript_file,
                "summary_path": summary_file,
                "speakers_detected": transcription_result.get("speakers_detected", "N/A"),
                "processing_time_seconds": round(processing_time, 2),
                "file_size_mb": round(file_size / (1024*1024), 2)
            }
        }), 200

    except Exception as e:
        logger.error(f"Error during processing: {e}")
        logger.error(traceback.format_exc())
        
        return jsonify({
            "error": "Processing failed",
            "message": str(e),
            "type": type(e).__name__
        }), 500

@app.route('/list-recordings', methods=['GET'])
def list_recordings():
    """List all recorded files"""
    try:
        recordings = []
        for filename in os.listdir(VIDEOS_DIR):
            if allowed_file(filename):
                file_path = os.path.join(VIDEOS_DIR, filename)
                stat = os.stat(file_path)
                recordings.append({
                    "filename": filename,
                    "size_mb": round(stat.st_size / (1024*1024), 2),
                    "created": datetime.fromtimestamp(stat.st_ctime).isoformat()
                })
        
        return jsonify({
            "success": True,
            "count": len(recordings),
            "recordings": sorted(recordings, key=lambda x: x['created'], reverse=True)
        }), 200
    
    except Exception as e:
        logger.error(f"Error listing recordings: {e}")
        return jsonify({"error": str(e)}), 500

# --- Error Handlers ---
@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error"""
    return jsonify({
        "error": "File too large",
        "message": f"Maximum file size is {MAX_FILE_SIZE / (1024*1024):.0f}MB"
    }), 413

@app.errorhandler(500)
def internal_server_error(error):
    """Handle internal server errors"""
    logger.error(f"Internal server error: {error}")
    return jsonify({
        "error": "Internal server error",
        "message": "An unexpected error occurred"
    }), 500

# --- Startup Banner ---
def print_startup_banner():
    """Print informative startup banner"""
    banner = f"""
{'=' * 70}
  LOCAL AI RECORDER - BACKEND SERVER
  Version: 2.1.0 (Production Ready)
  Status: Running
  
  Server URL: http://127.0.0.1:5000
  Health Check: http://127.0.0.1:5000/health
  
  Features:
  + Whisper Transcription with Speaker Diarization
  + AI-Powered Summarization
  + 100% Local & Private Processing
  + No External API Calls
  
  Output Directories:
  - Audio Files: {os.path.abspath(VIDEOS_DIR)}
  - Transcripts: {os.path.abspath(TRANSCRIBE_DIR)}
  - Summaries: {os.path.abspath(SUMMARY_DIR)}
  - Logs: {os.path.abspath(LOGS_DIR)}
  
  Press Ctrl+C to stop the server
{'=' * 70}
"""
    logger.info(banner)

# --- Start the Server ---
if __name__ == '__main__':
    print_startup_banner()
    
    # Production mode with proper error handling
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=False,  # Set to False for production
        threaded=True,
        use_reloader=False
    )
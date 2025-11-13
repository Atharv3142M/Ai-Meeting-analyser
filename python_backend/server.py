"""
Local AI Video Recorder - Production Server v2
Handles video/audio upload, processing, and database storage
"""

import os
import json
import logging
import threading
import subprocess
from datetime import datetime
from flask import Flask, request, jsonify, send_file, render_template
from flask_cors import CORS
from werkzeug.utils import secure_filename
import traceback

# Import local modules
import database as db
import transcriber
import summarizer

# ==================== Configuration ====================

# Directories
VIDEOS_DIR = "videos"
AUDIO_DIR = "audio"
COMPRESSED_DIR = "compressed"
TEMPLATES_DIR = "templates"
LOGS_DIR = "logs"

# File settings
ALLOWED_EXTENSIONS = {'webm', 'mp4', 'mkv', 'avi'}
MAX_FILE_SIZE = 1024 * 1024 * 1024  # 1GB

# Create directories
for directory in [VIDEOS_DIR, AUDIO_DIR, COMPRESSED_DIR, TEMPLATES_DIR, LOGS_DIR]:
    os.makedirs(directory, exist_ok=True)

# ==================== Flask App Setup ====================

app = Flask(__name__, template_folder=TEMPLATES_DIR)
CORS(app, resources={r"/*": {"origins": ["http://127.0.0.1:*", "http://localhost:*"]}})
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# ==================== Logging Setup ====================

def setup_logging():
    """Configure logging with UTF-8 encoding"""
    log_file = os.path.join(LOGS_DIR, f'server_{datetime.now().strftime("%Y%m%d")}.log')
    
    # File handler
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    file_format = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(file_format)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(file_format)
    
    # Root logger
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

logger = setup_logging()

# ==================== Helper Functions ====================

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_video_duration(video_path):
    """Get video duration using ffprobe"""
    try:
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        duration = float(result.stdout.strip())
        return int(duration)
    except Exception as e:
        logger.warning(f"Could not get video duration: {e}")
        return 0


def extract_audio_ffmpeg(video_path, audio_path):
    """Extract audio from video to WAV format"""
    try:
        logger.info(f"Extracting audio: {video_path} -> {audio_path}")
        
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vn',  # No video
            '-acodec', 'pcm_s16le',  # PCM 16-bit
            '-ar', '16000',  # 16kHz sample rate (optimal for Whisper)
            '-ac', '1',  # Mono
            '-y',  # Overwrite
            audio_path
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode != 0:
            raise Exception(f"FFmpeg audio extraction failed: {result.stderr}")
        
        logger.info(f"Audio extracted successfully: {audio_path}")
        return True
    
    except Exception as e:
        logger.error(f"Audio extraction error: {e}")
        raise


def compress_video_ffmpeg(input_path, output_path):
    """Compress video to web-friendly MP4 (H.264)"""
    try:
        logger.info(f"Compressing video: {input_path} -> {output_path}")
        
        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-c:v', 'libx264',  # H.264 codec
            '-preset', 'medium',  # Encoding speed
            '-crf', '23',  # Quality (lower = better, 18-28 is good)
            '-c:a', 'aac',  # AAC audio
            '-b:a', '128k',  # Audio bitrate
            '-movflags', '+faststart',  # Web optimization
            '-y',  # Overwrite
            output_path
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode != 0:
            raise Exception(f"FFmpeg compression failed: {result.stderr}")
        
        logger.info(f"Video compressed successfully: {output_path}")
        return True
    
    except Exception as e:
        logger.error(f"Video compression error: {e}")
        raise


def process_recording_pipeline(recording_id, video_path, audio_path, compressed_path):
    """
    Background processing pipeline
    Runs in separate thread to avoid blocking the upload response
    """
    try:
        logger.info(f"Starting processing pipeline for recording #{recording_id}")
        
        # Step 1: Extract audio
        logger.info("Step 1/4: Extracting audio...")
        extract_audio_ffmpeg(video_path, audio_path)
        db.update_recording(recording_id, audio_path=audio_path)
        
        # Step 2: Compress video
        logger.info("Step 2/4: Compressing video...")
        compress_video_ffmpeg(video_path, compressed_path)
        db.update_recording(recording_id, compressed_path=compressed_path)
        
        # Step 3: Transcribe with diarization
        logger.info("Step 3/4: Transcribing with speaker diarization...")
        transcript_result = transcriber.transcribe(audio_path)
        
        # Store transcript JSON
        transcript_json = json.dumps(transcript_result, ensure_ascii=False)
        
        # Update database with transcript
        db.update_recording(
            recording_id,
            transcript_json=transcript_json,
            language=transcript_result.get('language', 'unknown'),
            duration_seconds=transcript_result.get('duration', 0)
        )
        
        # Store speakers in database
        speaker_stats = transcript_result.get('speaker_stats', {})
        for speaker_label, stats in speaker_stats.items():
            db.create_or_update_speaker(
                recording_id=recording_id,
                speaker_label=speaker_label,
                segment_count=stats.get('segment_count', 0),
                total_duration=stats.get('total_duration', 0)
            )
        
        # Step 4: Summarize
        logger.info("Step 4/4: Generating AI summary...")
        summary_result = summarizer.summarize_from_transcript(transcript_result)
        
        # Update database with summary
        db.update_recording(
            recording_id,
            summary_text=summary_result.get('summary', '')
        )
        
        # Mark as completed
        db.update_recording_status(recording_id, "completed")
        logger.info(f"Processing complete for recording #{recording_id}")
        
    except Exception as e:
        error_msg = f"Processing failed: {str(e)}"
        logger.error(f"Recording #{recording_id}: {error_msg}")
        logger.error(traceback.format_exc())
        db.update_recording_status(recording_id, "failed", error_message=error_msg)


# ==================== API Routes ====================

@app.route('/')
def index():
    """Serve the dashboard"""
    return render_template('index.html')


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    stats = db.get_database_stats()
    return jsonify({
        "status": "healthy",
        "service": "Local AI Video Recorder",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "database": stats
    }), 200


@app.route('/upload', methods=['POST'])
def upload_video():
    """
    Upload and process video file
    Starts processing in background thread
    """
    try:
        # Validate request
        if 'audio' not in request.files and 'video' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        # Support both 'audio' and 'video' keys for backward compatibility
        file = request.files.get('video') or request.files.get('audio')
        
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        if not allowed_file(file.filename):
            return jsonify({
                "error": f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            }), 400
        
        # Get recording title
        title = request.form.get('title', '')
        if not title:
            title = os.path.splitext(file.filename)[0]
        
        # Sanitize filename
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = os.path.splitext(filename)[0]
        
        # Create file paths
        video_filename = f"{base_name}_{timestamp}.webm"
        video_path = os.path.join(VIDEOS_DIR, video_filename)
        audio_path = os.path.join(AUDIO_DIR, f"{base_name}_{timestamp}.wav")
        compressed_path = os.path.join(COMPRESSED_DIR, f"{base_name}_{timestamp}.mp4")
        
        # Save uploaded file
        file.save(video_path)
        file_size_mb = os.path.getsize(video_path) / (1024 * 1024)
        
        logger.info(f"Uploaded: {video_path} ({file_size_mb:.2f}MB)")
        
        # Create database entry
        recording_id = db.create_recording(
            title=title,
            video_path=video_path,
            file_size_mb=int(file_size_mb)
        )
        
        # Start background processing
        thread = threading.Thread(
            target=process_recording_pipeline,
            args=(recording_id, video_path, audio_path, compressed_path),
            daemon=True
        )
        thread.start()
        
        return jsonify({
            "success": True,
            "message": "Upload successful, processing started",
            "recording_id": recording_id,
            "status": "processing"
        }), 200
    
    except Exception as e:
        logger.error(f"Upload error: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


@app.route('/recordings', methods=['GET'])
def get_recordings():
    """Get all recordings"""
    try:
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
        status = request.args.get('status', None)
        
        recordings = db.get_all_recordings(limit=limit, offset=offset, status=status)
        
        return jsonify({
            "success": True,
            "count": len(recordings),
            "recordings": recordings
        }), 200
    
    except Exception as e:
        logger.error(f"Error fetching recordings: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/recordings/<int:recording_id>', methods=['GET'])
def get_recording_detail(recording_id):
    """Get detailed information about a recording"""
    try:
        recording = db.get_recording(recording_id)
        
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        return jsonify({
            "success": True,
            "recording": recording
        }), 200
    
    except Exception as e:
        logger.error(f"Error fetching recording #{recording_id}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/recordings/<int:recording_id>', methods=['DELETE'])
def delete_recording_endpoint(recording_id):
    """Delete a recording"""
    try:
        recording = db.get_recording(recording_id)
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        # Delete files
        for path_key in ['video_path', 'audio_path', 'compressed_path']:
            path = recording.get(path_key)
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                    logger.info(f"Deleted file: {path}")
                except Exception as e:
                    logger.warning(f"Could not delete {path}: {e}")
        
        # Delete from database
        db.delete_recording(recording_id)
        
        return jsonify({
            "success": True,
            "message": "Recording deleted"
        }), 200
    
    except Exception as e:
        logger.error(f"Error deleting recording #{recording_id}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/speakers/update', methods=['POST'])
def update_speaker():
    """Update speaker name (rename functionality)"""
    try:
        data = request.get_json()
        
        recording_id = data.get('recording_id')
        speaker_label = data.get('speaker_label')
        user_name = data.get('user_name')
        
        if not all([recording_id, speaker_label, user_name]):
            return jsonify({"error": "Missing required fields"}), 400
        
        db.update_speaker_name(recording_id, speaker_label, user_name)
        
        return jsonify({
            "success": True,
            "message": f"Speaker updated: {speaker_label} -> {user_name}"
        }), 200
    
    except Exception as e:
        logger.error(f"Error updating speaker: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/video/<int:recording_id>')
def serve_video(recording_id):
    """Serve video file for playback"""
    try:
        recording = db.get_recording(recording_id)
        
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        # Prefer compressed version for web playback
        video_path = recording.get('compressed_path') or recording.get('video_path')
        
        if not video_path or not os.path.exists(video_path):
            return jsonify({"error": "Video file not found"}), 404
        
        return send_file(video_path, mimetype='video/mp4')
    
    except Exception as e:
        logger.error(f"Error serving video #{recording_id}: {e}")
        return jsonify({"error": str(e)}), 500


# ==================== Error Handlers ====================

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large"""
    return jsonify({
        "error": "File too large",
        "message": f"Maximum file size is {MAX_FILE_SIZE / (1024*1024):.0f}MB"
    }), 413


@app.errorhandler(500)
def internal_server_error(error):
    """Handle internal errors"""
    logger.error(f"Internal server error: {error}")
    return jsonify({"error": "Internal server error"}), 500


# ==================== Startup ====================

def print_startup_banner():
    """Print server startup information"""
    banner = """
====================================================================
  LOCAL AI VIDEO RECORDER - PRODUCTION SERVER v2.0
====================================================================
  
  Server URL: http://127.0.0.1:5000
  Dashboard: http://127.0.0.1:5000
  Health Check: http://127.0.0.1:5000/health
  
  Features:
  - Video + Audio Recording with Tab Playback
  - GPU-Accelerated Whisper Transcription
  - Advanced Speaker Diarization (Smoothing Algorithm)
  - AI Summarization via Ollama
  - SQLite Database Storage
  - Web Dashboard with Video Player
  
  Database: meetings.db
  Storage:
  - Original Videos: videos/
  - Extracted Audio: audio/
  - Compressed Videos: compressed/
  - Logs: logs/
  
  Press Ctrl+C to stop
====================================================================
"""
    logger.info(banner)


if __name__ == '__main__':
    # Initialize database
    db.init_database()
    
    # Print startup info
    print_startup_banner()
    
    # Run server
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=False,
        threaded=True,
        use_reloader=False
    )
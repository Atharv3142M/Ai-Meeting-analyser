"""
POAi v2.0 - Production Server with MongoDB
Handles video/audio recording, processing, and AI analysis
"""

import os
import json
import logging
import threading
import subprocess
from datetime import datetime
from bson import ObjectId
from flask import Flask, request, jsonify, send_file, render_template, Response, stream_with_context
from flask_cors import CORS
from werkzeug.utils import secure_filename
import traceback
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure

# Import local modules
import transcriber
import summarizer

# ==================== Configuration ====================

VIDEOS_DIR = "videos"
AUDIO_DIR = "audio"
COMPRESSED_DIR = "compressed"
TEMPLATES_DIR = "templates"
STATIC_DIR = "static"
LOGS_DIR = "logs"

ALLOWED_EXTENSIONS = {'webm', 'mp4', 'mkv', 'avi'}
MAX_FILE_SIZE = 1024 * 1024 * 1024  # 1GB

# MongoDB Configuration
MONGO_URI = "mongodb://localhost:27017/"
DB_NAME = "poai_db"

# Create directories
for directory in [VIDEOS_DIR, AUDIO_DIR, COMPRESSED_DIR, TEMPLATES_DIR, STATIC_DIR, LOGS_DIR]:
    os.makedirs(directory, exist_ok=True)

# ==================== Flask App Setup ====================

app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)
CORS(app, resources={r"/*": {"origins": ["http://127.0.0.1:*", "http://localhost:*"]}})
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# ==================== Logging Setup ====================

def setup_logging():
    """Configure logging"""
    log_file = os.path.join(LOGS_DIR, f'poai_{datetime.now().strftime("%Y%m%d")}.log')
    
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    file_format = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(file_format)
    
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(file_format)
    
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

logger = setup_logging()

# ==================== MongoDB Connection ====================

def init_mongodb():
    """Initialize MongoDB connection and collections"""
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.server_info()  # Force connection
        
        db = client[DB_NAME]
        
        if 'recordings' not in db.list_collection_names():
            db.create_collection('recordings')
            logger.info("Created 'recordings' collection")
        
        if 'speakers' not in db.list_collection_names():
            db.create_collection('speakers')
            logger.info("Created 'speakers' collection")
        
        db.recordings.create_index([('created_at', DESCENDING)])
        db.recordings.create_index([('status', ASCENDING)])
        db.speakers.create_index([('recording_id', ASCENDING)])
        
        logger.info(f"MongoDB connected: {DB_NAME}")
        return db
    
    except ConnectionFailure as e:
        logger.error(f"MongoDB connection failed: {e}")
        logger.error("Please ensure MongoDB is running on localhost:27017")
        raise

try:
    db = init_mongodb()
except Exception as e:
    logger.critical("Cannot start without MongoDB!")
    raise

# ==================== Helper Functions ====================

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def serialize_doc(doc):
    if doc is None:
        return None
    if isinstance(doc, list):
        return [serialize_doc(d) for d in doc]
    if '_id' in doc:
        doc['_id'] = str(doc['_id'])
    if 'recording_id' in doc and isinstance(doc['recording_id'], ObjectId):
        doc['recording_id'] = str(doc['recording_id'])
    if 'created_at' in doc and isinstance(doc['created_at'], datetime):
        doc['created_at'] = doc['created_at'].isoformat()
    return doc

def get_video_duration(video_path):
    try:
        cmd = [
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        duration = float(result.stdout.strip())
        return int(duration)
    except Exception as e:
        logger.warning(f"Could not get video duration: {e}")
        return 0

# ==================== FFmpeg Processing Functions ====================

def fix_video_ffmpeg(input_path, output_path):
    """
    Re-muxes the (potentially corrupt) input .webm into a stable .mp4.
    """
    try:
        logger.info(f"Fixing corrupt video: {input_path} -> {output_path}")
        
        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-c:v', 'copy',       # Copy video stream
            '-c:a', 'copy',       # Copy audio stream
            '-y',
            output_path
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300, # 5 minutes
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode != 0:
            logger.warning(f"FFmpeg copy failed, trying re-encode: {result.stderr}")
            return compress_video_ffmpeg(input_path, output_path, is_fallback=True)

        logger.info(f"Video fixed and re-muxed successfully")
        return True
    
    except Exception as e:
        logger.error(f"Video fix error: {e}")
        raise

def extract_audio_ffmpeg(video_path, audio_path):
    """Extract audio from a video file to WAV"""
    try:
        logger.info(f"Extracting audio: {video_path} -> {audio_path}")
        
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vn',
            '-acodec', 'pcm_s16le',
            '-ar', '16000',
            '-ac', '1',
            '-y',
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
        
        logger.info(f"Audio extracted successfully")
        return True
    
    except Exception as e:
        logger.error(f"Audio extraction error: {e}")
        raise

def compress_video_ffmpeg(input_path, output_path, is_fallback=False):
    """
    Compress video to web-friendly MP4.
    """
    try:
        if is_fallback:
            logger.info(f"Fallback: Re-encoding video: {input_path} -> {output_path}")
        else:
            logger.info(f"Compressing video: {input_path} -> {output_path}")
        
        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-y',
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
            raise Exception(f"FFmpeg compression/re-encode failed: {result.stderr}")
        
        logger.info(f"Video compressed/re-encoded successfully")
        return True
    
    except Exception as e:
        logger.error(f"Video compression/re-encode error: {e}")
        raise

# ==================== Background Pipeline ====================

def process_recording_pipeline(recording_id, fixed_video_path, audio_path):
    """
    Background processing pipeline.
    """
    try:
        logger.info(f"Starting processing pipeline for recording: {recording_id}")
        
        # Step 1: Extract audio (from the *fixed* video)
        logger.info("Step 1/3: Extracting audio...")
        extract_audio_ffmpeg(fixed_video_path, audio_path)
        db.recordings.update_one(
            {'_id': ObjectId(recording_id)},
            {'$set': {'paths.audio': audio_path}}
        )
        
        # Step 2: Transcribe with diarization
        logger.info("Step 2/3: Transcribing with speaker diarization...")
        transcript_result = transcriber.transcribe(audio_path)
        
        # Get duration from fixed video
        duration = get_video_duration(fixed_video_path)
        
        # Update recording with transcript
        db.recordings.update_one(
            {'_id': ObjectId(recording_id)},
            {'$set': {
                'transcript': transcript_result['segments'],
                'metadata.language': transcript_result.get('language', 'unknown'),
                'metadata.duration': duration,
                'metadata.num_speakers': transcript_result.get('num_speakers', 0)
            }}
        )
        
        # Store speakers
        speaker_stats = transcript_result.get('speaker_stats', {})
        for speaker_label, stats in speaker_stats.items():
            db.speakers.update_one(
                {'recording_id': ObjectId(recording_id), 'speaker_label': speaker_label},
                {'$set': {
                    'recording_id': ObjectId(recording_id),
                    'speaker_label': speaker_label,
                    'segment_count': stats.get('segment_count', 0),
                    'total_duration': stats.get('total_duration', 0),
                    'display_name': None
                }},
                upsert=True
            )
        
        # Step 3: Summarize
        logger.info("Step 3/3: Generating AI summary...")
        summary_result = summarizer.summarize_from_transcript(transcript_result)
        
        # Update with summary and set status to completed
        db.recordings.update_one(
            {'_id': ObjectId(recording_id)},
            {'$set': {
                'summary': summary_result.get('summary', ''),
                'status': 'completed'
            }}
        )
        
        logger.info(f"Processing complete for recording: {recording_id}")
        
    except Exception as e:
        error_msg = f"Processing failed: {str(e)}"
        logger.error(f"Recording {recording_id}: {error_msg}")
        logger.error(traceback.format_exc())
        
        db.recordings.update_one(
            {'_id': ObjectId(recording_id)},
            {'$set': {
                'status': 'failed',
                'error_message': error_msg
            }}
        )

# ==================== API Routes ====================

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/health', methods=['GET'])
def health_check():
    try:
        total = db.recordings.count_documents({})
        completed = db.recordings.count_documents({'status': 'completed'})
        processing = db.recordings.count_documents({'status': 'processing'})
        failed = db.recordings.count_documents({'status': 'failed'})
        
        return jsonify({
            "status": "healthy",
            "service": "POAi v2.0",
            "version": "2.0.1-fix", # New version
            "timestamp": datetime.utcnow().isoformat(),
            "database": {
                "total_recordings": total,
                "completed": completed,
                "processing": processing,
                "failed": failed
            }
        }), 200
    except Exception as e:
        return jsonify({"status": "unhealthy", "error": str(e)}), 500

@app.route('/upload', methods=['POST'])
def upload_video():
    """
    Upload video file, FIX IT, and start processing.
    """
    try:
        if 'audio' not in request.files and 'video' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files.get('video') or request.files.get('audio')
        
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        if not allowed_file(file.filename):
            return jsonify({"error": f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"}), 400
        
        title = request.form.get('title', os.path.splitext(file.filename)[0])
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = os.path.splitext(filename)[0]
        
        # --- NEW PATHS ---
        # 1. Path for the original, (corrupt) uploaded file
        original_video_path = os.path.join(VIDEOS_DIR, f"{base_name}_{timestamp}_original.webm")
        
        # 2. Path for the new, fixed .mp4 file (will be used for processing and dashboard)
        fixed_video_path = os.path.join(COMPRESSED_DIR, f"{base_name}_{timestamp}.mp4")
        
        # 3. Path for the extracted audio
        audio_path = os.path.join(AUDIO_DIR, f"{base_name}_{timestamp}.wav")
        
        # Save uploaded file
        file.save(original_video_path)
        file_size_mb = os.path.getsize(original_video_path) / (1024 * 1024)
        
        logger.info(f"Uploaded: {original_video_path} ({file_size_mb:.2f}MB)")
        
        # --- NEW STEP: FIX-IT-FIRST ---
        try:
            fix_video_ffmpeg(original_video_path, fixed_video_path)
        except Exception as fix_error:
            # If the fix fails, the file is truly unrecoverable.
            logger.error(f"Failed to fix video {original_video_path}: {fix_error}")
            # Create a failed DB entry
            recording = {
                'title': title, 'status': 'failed', 'created_at': datetime.utcnow(),
                'paths': {'video': original_video_path},
                'metadata': {'size_mb': int(file_size_mb)},
                'error_message': f"Failed to fix/re-mux video: {str(fix_error)}"
            }
            db.recordings.insert_one(recording)
            return jsonify({"error": "File is corrupt and could not be fixed"}), 400
        
        # --- Create MongoDB document (AFTER FIX) ---
        recording = {
            'title': title,
            'status': 'processing',
            'created_at': datetime.utcnow(),
            'paths': {
                'video': original_video_path,  # Store original
                'audio': None,
                'compressed': fixed_video_path # Store fixed path for dashboard
            },
            'metadata': {
                'size_mb': int(file_size_mb),
                'duration': 0, 'language': 'unknown', 'num_speakers': 0
            },
            'transcript': [], 'summary': '', 'error_message': None
        }
        
        result = db.recordings.insert_one(recording)
        recording_id = str(result.inserted_id)
        
        logger.info(f"Created recording: {recording_id}")
        
        # Start background processing with the FIXED video path
        thread = threading.Thread(
            target=process_recording_pipeline,
            args=(recording_id, fixed_video_path, audio_path),
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
    try:
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
        status = request.args.get('status', None)
        
        query = {}
        if status:
            query['status'] = status
        
        recordings = list(db.recordings.find(query)
                         .sort('created_at', DESCENDING)
                         .limit(limit)
                         .skip(offset))
        
        return jsonify({
            "success": True,
            "count": len(recordings),
            "recordings": serialize_doc(recordings)
        }), 200
    
    except Exception as e:
        logger.error(f"Error fetching recordings: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/recordings/<recording_id>', methods=['GET'])
def get_recording_detail(recording_id):
    try:
        recording = db.recordings.find_one({'_id': ObjectId(recording_id)})
        
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        speakers = list(db.speakers.find({'recording_id': ObjectId(recording_id)}))
        recording['speakers'] = serialize_doc(speakers)
        
        return jsonify({
            "success": True,
            "recording": serialize_doc(recording)
        }), 200
    
    except Exception as e:
        logger.error(f"Error fetching recording: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/recordings/<recording_id>', methods=['DELETE'])
def delete_recording(recording_id):
    try:
        recording = db.recordings.find_one({'_id': ObjectId(recording_id)})
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        # Delete all associated files
        for path_key in ['video', 'audio', 'compressed']:
            path = recording.get('paths', {}).get(path_key)
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                    logger.info(f"Deleted file: {path}")
                except Exception as e:
                    logger.warning(f"Could not delete {path}: {e}")
        
        db.recordings.delete_one({'_id': ObjectId(recording_id)})
        db.speakers.delete_many({'recording_id': ObjectId(recording_id)})
        
        return jsonify({"success": True, "message": "Recording deleted"}), 200
    
    except Exception as e:
        logger.error(f"Error deleting recording: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/speakers/update', methods=['POST'])
def update_speaker():
    try:
        data = request.get_json()
        recording_id = data.get('recording_id')
        speaker_label = data.get('speaker_label')
        display_name = data.get('display_name')
        
        if not all([recording_id, speaker_label, display_name]):
            return jsonify({"error": "Missing required fields"}), 400
        
        result = db.speakers.update_one(
            {'recording_id': ObjectId(recording_id), 'speaker_label': speaker_label},
            {'$set': {'display_name': display_name}}
        )
        
        if result.modified_count == 0:
            return jsonify({"error": "Speaker not found"}), 404
        
        return jsonify({"success": True, "message": f"Speaker updated"}), 200
    except Exception as e:
        logger.error(f"Error updating speaker: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/video/<recording_id>')
def serve_video(recording_id):
    """Serve video file with Range request support"""
    try:
        recording = db.recordings.find_one({'_id': ObjectId(recording_id)})
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        # Serve the compressed/fixed MP4 file
        video_path = recording.get('paths', {}).get('compressed')
        
        if not video_path or not os.path.exists(video_path):
            # Fallback to original video if compressed one is missing
            video_path = recording.get('paths', {}).get('video')
            if not video_path or not os.path.exists(video_path):
                return jsonify({"error": "Video file not found"}), 404
        
        # Flask's send_file supports ranges out of the box if simple
        # But explicit range support is better for seeking in large files
        return send_file(video_path, conditional=True)
    
    except Exception as e:
        logger.error(f"Error serving video: {e}")
        return jsonify({"error": str(e)}), 500

# ==================== Error Handlers ====================

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({
        "error": "File too large",
        "message": f"Maximum file size is {MAX_FILE_SIZE / (1024*1024):.0f}MB"
    }), 413

@app.errorhandler(500)
def internal_server_error(error):
    logger.error(f"Internal server error: {error}")
    return jsonify({"error": "Internal server error"}), 500

# ==================== Startup ====================

def print_startup_banner():
    banner = """
====================================================================
  POAi v2.0 - Productivity Optimization Assistant AI
  Production Server with MongoDB (and Fix-it-First Logic)
====================================================================
  
  Server URL: http://127.0.0.1:5000
  Dashboard: http://127.0.0.1:5000
  Health Check: http://127.0.0.1:5000/health
  
  Features:
  - Video + Audio Recording with Monitoring
  - **NEW: FFmpeg re-muxing to fix corrupt uploads**
  - GPU-Accelerated Whisper Transcription
  - Advanced Speaker Diarization
  - AI Summarization via Ollama
  - MongoDB NoSQL Database
  - Professional Dark Mode UI
  
  Database: MongoDB - poai_db
  Collections: recordings, speakers
  
  Press Ctrl+C to stop
====================================================================
"""
    logger.info(banner)

if __name__ == '__main__':
    print_startup_banner()
    
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=False,
        threaded=True,
        use_reloader=False
    )
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
from flask import Flask, request, jsonify, send_file, render_template
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
        
        # Create collections if they don't exist
        if 'recordings' not in db.list_collection_names():
            db.create_collection('recordings')
            logger.info("Created 'recordings' collection")
        
        if 'speakers' not in db.list_collection_names():
            db.create_collection('speakers')
            logger.info("Created 'speakers' collection")
        
        # Create indexes
        db.recordings.create_index([('created_at', DESCENDING)])
        db.recordings.create_index([('status', ASCENDING)])
        db.speakers.create_index([('recording_id', ASCENDING)])
        
        logger.info(f"MongoDB connected: {DB_NAME}")
        return db
    
    except ConnectionFailure as e:
        logger.error(f"MongoDB connection failed: {e}")
        logger.error("Please ensure MongoDB is running on localhost:27017")
        raise

# Initialize MongoDB
try:
    db = init_mongodb()
except Exception as e:
    logger.critical("Cannot start without MongoDB!")
    raise

# ==================== Helper Functions ====================

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable dict"""
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
    """Extract audio from video to WAV"""
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

def compress_video_ffmpeg(input_path, output_path):
    """Compress video to web-friendly MP4"""
    try:
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
            raise Exception(f"FFmpeg compression failed: {result.stderr}")
        
        logger.info(f"Video compressed successfully")
        return True
    
    except Exception as e:
        logger.error(f"Video compression error: {e}")
        raise

def process_recording_pipeline(recording_id, video_path, audio_path, compressed_path):
    """Background processing pipeline with robust error handling"""
    try:
        logger.info(f"Starting processing pipeline for recording: {recording_id}")
        
        # CRITICAL: Validate input file before processing
        logger.info("Validating uploaded file...")
        
        if not os.path.exists(video_path):
            raise Exception(f"Video file not found: {video_path}")
        
        file_size = os.path.getsize(video_path)
        logger.info(f"Video file size: {file_size} bytes ({file_size / (1024*1024):.2f} MB)")
        
        if file_size == 0:
            raise Exception("Video file is empty (0 bytes)")
        
        if file_size < 10000:
            raise Exception(f"Video file too small ({file_size} bytes) - likely corrupted")
        
        # Validate WebM header
        with open(video_path, 'rb') as f:
            header = f.read(4)
        
        # WebM/MKV signature: 0x1A 0x45 0xDF 0xA3
        expected_sig = bytes([0x1A, 0x45, 0xDF, 0xA3])
        
        if header != expected_sig:
            logger.error(f"Invalid WebM header: {header.hex()}")
            logger.error(f"Expected: {expected_sig.hex()}")
            raise Exception(f"Invalid WebM header - file corrupted. Got: {header.hex()}")
        
        logger.info("✓ File validation passed - valid WebM header")
        
        # Step 1: Extract audio
        logger.info("Step 1/4: Extracting audio...")
        extract_audio_ffmpeg(video_path, audio_path)
        db.recordings.update_one(
            {'_id': ObjectId(recording_id)},
            {'$set': {'paths.audio': audio_path}}
        )
        
        # Step 2: Compress video
        logger.info("Step 2/4: Compressing video...")
        compress_video_ffmpeg(video_path, compressed_path)
        db.recordings.update_one(
            {'_id': ObjectId(recording_id)},
            {'$set': {'paths.compressed': compressed_path}}
        )
        
        # Step 3: Transcribe with diarization
        logger.info("Step 3/4: Transcribing with speaker diarization...")
        transcript_result = transcriber.transcribe(audio_path)
        
        # Update recording with transcript
        db.recordings.update_one(
            {'_id': ObjectId(recording_id)},
            {'$set': {
                'transcript': transcript_result['segments'],
                'metadata.language': transcript_result.get('language', 'unknown'),
                'metadata.duration': transcript_result.get('duration', 0),
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
        
        # Step 4: Summarize
        logger.info("Step 4/4: Generating AI summary...")
        summary_result = summarizer.summarize_from_transcript(transcript_result)
        
        # Update with summary
        db.recordings.update_one(
            {'_id': ObjectId(recording_id)},
            {'$set': {
                'summary': summary_result.get('summary', ''),
                'status': 'completed'
            }}
        )
        
        logger.info(f"✓ Processing complete for recording: {recording_id}")
        
    except Exception as e:
        error_msg = f"Processing failed: {str(e)}"
        logger.error(f"Recording {recording_id}: {error_msg}")
        logger.error(traceback.format_exc())
        
        # Check if it's a file corruption issue
        if "EBML header" in str(e) or "Invalid data" in str(e) or "Invalid WebM header" in str(e):
            error_msg = "File corrupted during recording. Please try again and wait 2-3 seconds before stopping."
        
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
    """Serve the dashboard"""
    return render_template('index.html')

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        total = db.recordings.count_documents({})
        completed = db.recordings.count_documents({'status': 'completed'})
        processing = db.recordings.count_documents({'status': 'processing'})
        failed = db.recordings.count_documents({'status': 'failed'})
        
        return jsonify({
            "status": "healthy",
            "service": "POAi v2.0",
            "version": "2.0.0",
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
    """Upload and process video file"""
    try:
        if 'audio' not in request.files and 'video' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files.get('video') or request.files.get('audio')
        
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        if not allowed_file(file.filename):
            return jsonify({
                "error": f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            }), 400
        
        # Get title
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
        
        # Create MongoDB document
        recording = {
            'title': title,
            'status': 'processing',
            'created_at': datetime.utcnow(),
            'paths': {
                'video': video_path,
                'audio': None,
                'compressed': None
            },
            'metadata': {
                'size_mb': int(file_size_mb),
                'duration': 0,
                'language': 'unknown',
                'num_speakers': 0
            },
            'transcript': [],
            'summary': '',
            'error_message': None
        }
        
        result = db.recordings.insert_one(recording)
        recording_id = str(result.inserted_id)
        
        logger.info(f"Created recording: {recording_id}")
        
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
    """Get detailed recording information"""
    try:
        recording = db.recordings.find_one({'_id': ObjectId(recording_id)})
        
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        # Get speakers
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
    """Delete a recording"""
    try:
        recording = db.recordings.find_one({'_id': ObjectId(recording_id)})
        
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        # Delete files
        for path_key in ['video', 'audio', 'compressed']:
            path = recording.get('paths', {}).get(path_key)
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                    logger.info(f"Deleted file: {path}")
                except Exception as e:
                    logger.warning(f"Could not delete {path}: {e}")
        
        # Delete from database
        db.recordings.delete_one({'_id': ObjectId(recording_id)})
        db.speakers.delete_many({'recording_id': ObjectId(recording_id)})
        
        return jsonify({
            "success": True,
            "message": "Recording deleted"
        }), 200
    
    except Exception as e:
        logger.error(f"Error deleting recording: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/speakers/update', methods=['POST'])
def update_speaker():
    """Update speaker display name"""
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
        
        return jsonify({
            "success": True,
            "message": f"Speaker updated: {speaker_label} → {display_name}"
        }), 200
    
    except Exception as e:
        logger.error(f"Error updating speaker: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/video/<recording_id>')
def serve_video(recording_id):
    """Serve video file"""
    try:
        recording = db.recordings.find_one({'_id': ObjectId(recording_id)})
        
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        
        video_path = recording.get('paths', {}).get('compressed') or recording.get('paths', {}).get('video')
        
        if not video_path or not os.path.exists(video_path):
            return jsonify({"error": "Video file not found"}), 404
        
        return send_file(video_path, mimetype='video/mp4')
    
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
    """Print server startup information"""
    banner = """
====================================================================
  POAi v2.0 - Productivity Optimization Assistant AI
  Production Server with MongoDB
====================================================================
  
  Server URL: http://127.0.0.1:5000
  Dashboard: http://127.0.0.1:5000
  Health Check: http://127.0.0.1:5000/health
  
  Features:
  - Video + Audio Recording with Monitoring
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
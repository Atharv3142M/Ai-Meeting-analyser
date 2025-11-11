import os
import transcriber  # This is our existing transcriber.py
import summarizer   # This is our existing summarizer.py
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
import logging

# --- Configuration ---
# Define the output directories.
TRANSCRIBE_DIR = "transcribe"
SUMMARY_DIR = "summary"
VIDEOS_DIR = "videos" # Folder to store the original audio

# Create them if they don't exist
os.makedirs(TRANSCRIBE_DIR, exist_ok=True)
os.makedirs(SUMMARY_DIR, exist_ok=True)
os.makedirs(VIDEOS_DIR, exist_ok=True)

# --- Flask Server Setup ---
app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = app.logger

# --- Helper Function ---
def create_output_paths(audio_filename):
    """
    Creates full paths for the transcript and summary files
    based on the input audio filename.
    """
    # Get the base filename without the .mp4 or .webm
    base_name = os.path.splitext(os.path.basename(audio_filename))[0]
    
    # Create the new filenames
    transcript_filename = f"{base_name}_transcript.txt"
    summary_filename = f"{base_name}_meeting_summary.txt"
    
    # Create the full paths, joining the folder and filename
    # e.g., "transcribe/My Meeting_transcript.txt"
    transcript_full_path = os.path.join(TRANSCRIBE_DIR, transcript_filename)
    summary_full_path = os.path.join(SUMMARY_DIR, summary_filename)
    
    logger.info(f"Transcript path: {transcript_full_path}")
    logger.info(f"Summary path: {summary_full_path}")
    
    return transcript_full_path, summary_full_path

# --- The Server's Main Endpoint ---
@app.route('/upload', methods=['POST'])
def upload_and_process():
    logger.info("="*30)
    logger.info("New request received...")

    if 'audio' not in request.files:
        logger.warning("No 'audio' file in request")
        return jsonify({"error": "No audio file part"}), 400

    file = request.files['audio']
    
    if file.filename == '':
        logger.warning("No selected file")
        return jsonify({"error": "No selected file"}), 400

    if file:
        # Sanitize the filename from the extension
        filename = secure_filename(file.filename)
        
        # Save the original audio file to our 'videos' folder
        audio_save_path = os.path.join(VIDEOS_DIR, filename)
        file.save(audio_save_path)
        logger.info(f"Audio saved to: {audio_save_path}")
        
        # 1. Generate our output file paths
        transcript_file, summary_file = create_output_paths(filename)
        
        try:
            # 2. Transcribe
            logger.info(f"Transcribing '{filename}'...")
            transcriber.transcribe(audio_save_path, transcript_file)
            logger.info(f"Transcript saved: {transcript_file}")

            # 3. Summarize
            logger.info("Summarizing transcript...")
            summarizer.summarize(transcript_file, summary_file)
            logger.info(f"Summary saved: {summary_file}")

            logger.info("--- Process Complete! ---")
            return jsonify({
                "success": True, 
                "message": "Processed successfully",
                "transcript_path": transcript_file,
                "summary_path": summary_file
            }), 200

        except Exception as e:
            logger.error(f"Error during processing: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500

    return jsonify({"error": "Unknown error"}), 500

# --- Start the Server ---
if __name__ == '__main__':
    logger.info("="*30)
    logger.info("Starting local AI server at http://127.0.0.1:5000")
    logger.info("This server is 100% local and private.")
    logger.info("Waiting for audio from the Chrome extension...")
    logger.info("="*30)
    # 'debug=True' is good for development
    # Change to 'debug=False' for "production"
    app.run(host='127.0.0.1', port=5000, debug=True)
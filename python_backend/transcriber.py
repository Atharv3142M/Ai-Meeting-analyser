import whisper
import yaml
import os
import logging
from datetime import timedelta
import json

logger = logging.getLogger(__name__)

def load_config():
    """Load configuration from YAML file"""
    try:
        with open("config.yaml", "r") as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        logger.warning("config.yaml not found, using defaults")
        return {
            "transcription": {"model": "small"},
            "diarization": {"enabled": True, "min_speakers": 1, "max_speakers": 10}
        }

def format_timestamp(seconds):
    """Convert seconds to readable timestamp format"""
    td = timedelta(seconds=seconds)
    hours = td.seconds // 3600
    minutes = (td.seconds % 3600) // 60
    secs = td.seconds % 60
    
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    else:
        return f"{minutes:02d}:{secs:02d}"

def detect_speaker_changes(segments, threshold=2.0):
    """
    Simple speaker change detection based on pauses and content.
    This is a basic implementation - for advanced diarization, 
    consider using pyannote.audio
    
    Args:
        segments: List of segment dictionaries from Whisper
        threshold: Minimum pause duration (seconds) to consider a speaker change
    
    Returns:
        List of segments with speaker labels
    """
    if not segments:
        return []
    
    speaker_segments = []
    current_speaker = 1
    last_end_time = 0
    
    for i, segment in enumerate(segments):
        start_time = segment['start']
        
        # Detect speaker change based on pause duration
        pause_duration = start_time - last_end_time
        
        if pause_duration > threshold and i > 0:
            # Long pause suggests speaker change
            current_speaker += 1
        
        speaker_segments.append({
            'speaker': f'Speaker {current_speaker}',
            'start': start_time,
            'end': segment['end'],
            'text': segment['text'].strip()
        })
        
        last_end_time = segment['end']
    
    return speaker_segments

def format_transcript_with_speakers(speaker_segments):
    """
    Format transcript with speaker labels and timestamps
    
    Args:
        speaker_segments: List of segments with speaker information
    
    Returns:
        Formatted transcript string
    """
    if not speaker_segments:
        return "No transcript available."
    
    lines = []
    lines.append("=" * 80)
    lines.append("MEETING TRANSCRIPT WITH SPEAKER IDENTIFICATION")
    lines.append("=" * 80)
    lines.append("")
    
    current_speaker = None
    speaker_text = []
    
    for segment in speaker_segments:
        speaker = segment['speaker']
        timestamp = format_timestamp(segment['start'])
        text = segment['text']
        
        if speaker != current_speaker:
            # New speaker - write previous speaker's text
            if current_speaker and speaker_text:
                lines.append(f"\n{current_speaker}:")
                lines.append(' '.join(speaker_text))
                lines.append("")
            
            current_speaker = speaker
            speaker_text = [f"[{timestamp}] {text}"]
        else:
            # Same speaker - accumulate text
            speaker_text.append(text)
    
    # Write last speaker's text
    if current_speaker and speaker_text:
        lines.append(f"\n{current_speaker}:")
        lines.append(' '.join(speaker_text))
    
    lines.append("")
    lines.append("=" * 80)
    lines.append(f"Total Speakers Detected: {len(set(seg['speaker'] for seg in speaker_segments))}")
    lines.append("=" * 80)
    
    return '\n'.join(lines)

def format_transcript_timestamped(speaker_segments):
    """
    Alternative format: Each segment on its own line with timestamp
    
    Args:
        speaker_segments: List of segments with speaker information
    
    Returns:
        Formatted transcript string
    """
    if not speaker_segments:
        return "No transcript available."
    
    lines = []
    lines.append("=" * 80)
    lines.append("DETAILED TRANSCRIPT WITH TIMESTAMPS")
    lines.append("=" * 80)
    lines.append("")
    
    for segment in speaker_segments:
        speaker = segment['speaker']
        start = format_timestamp(segment['start'])
        end = format_timestamp(segment['end'])
        text = segment['text']
        
        lines.append(f"[{start} - {end}] {speaker}:")
        lines.append(f"  {text}")
        lines.append("")
    
    lines.append("=" * 80)
    lines.append(f"Total Duration: {format_timestamp(speaker_segments[-1]['end'])}")
    lines.append(f"Total Speakers: {len(set(seg['speaker'] for seg in speaker_segments))}")
    lines.append("=" * 80)
    
    return '\n'.join(lines)

def transcribe(audio_file_path, transcript_file=None):
    """
    Transcribe an audio file using Whisper with speaker diarization.

    Args:
        audio_file_path (str): Path to the recorded audio file.
        transcript_file (str, optional): Path to save the transcript text. 
            If None, generates a filename based on the audio file.

    Returns:
        dict: Dictionary containing:
            - transcript_path: Path to saved transcript
            - speakers_detected: Number of speakers detected
            - duration: Total audio duration in seconds
    """
    try:
        # Validate input file
        if not os.path.exists(audio_file_path):
            raise FileNotFoundError(f"Audio file not found: {audio_file_path}")
        
        file_size = os.path.getsize(audio_file_path)
        if file_size == 0:
            raise ValueError("Audio file is empty")
        
        logger.info(f"Audio file size: {file_size / (1024*1024):.2f}MB")
        
        # Load configuration
        cfg = load_config()
        model_name = cfg.get("transcription", {}).get("model", "small")
        diarization_enabled = cfg.get("diarization", {}).get("enabled", True)
        
        logger.info(f"Loading Whisper model '{model_name}'...")
        model = whisper.load_model(model_name)
        
        # Generate transcript filename if not provided
        if transcript_file is None:
            base_name = os.path.splitext(os.path.basename(audio_file_path))[0]
            transcript_file = f"{base_name}_transcript.txt"
        
        logger.info("Starting transcription (this may take a few minutes)...")
        
        # Transcribe with word-level timestamps
        result = model.transcribe(
            audio_file_path,
            fp16=False,  # Use FP32 for CPU compatibility
            verbose=False,
            word_timestamps=True
        )
        
        # Extract segments
        segments = result.get("segments", [])
        full_text = result.get("text", "")
        
        logger.info(f"Transcription complete. Found {len(segments)} segments.")
        
        # Perform speaker diarization
        speaker_segments = []
        speakers_detected = 1
        
        if diarization_enabled and segments:
            logger.info("Performing speaker diarization...")
            speaker_segments = detect_speaker_changes(segments, threshold=2.0)
            speakers_detected = len(set(seg['speaker'] for seg in speaker_segments))
            logger.info(f"Detected {speakers_detected} potential speakers")
        
        # Format and save transcript
        logger.info(f"Saving transcript to: {transcript_file}")
        
        with open(transcript_file, "w", encoding="utf-8") as f:
            if diarization_enabled and speaker_segments:
                # Write speaker-labeled transcript
                f.write(format_transcript_with_speakers(speaker_segments))
                f.write("\n\n")
                f.write("=" * 80)
                f.write("\nDETAILED TIMESTAMPED VERSION\n")
                f.write("=" * 80)
                f.write("\n\n")
                f.write(format_transcript_timestamped(speaker_segments))
            else:
                # Write plain transcript
                f.write("=" * 80)
                f.write("\nMEETING TRANSCRIPT\n")
                f.write("=" * 80)
                f.write("\n\n")
                f.write(full_text)
                f.write("\n\n")
                f.write("=" * 80)
        
        # Also save JSON metadata
        json_file = transcript_file.replace('.txt', '_metadata.json')
        metadata = {
            "audio_file": os.path.basename(audio_file_path),
            "duration_seconds": result.get("duration", 0),
            "language": result.get("language", "unknown"),
            "speakers_detected": speakers_detected,
            "segments_count": len(segments),
            "diarization_enabled": diarization_enabled,
            "model_used": model_name
        }
        
        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
        
        logger.info(f"Metadata saved to: {json_file}")
        logger.info("Transcription complete.")
        
        return {
            "transcript_path": transcript_file,
            "metadata_path": json_file,
            "speakers_detected": speakers_detected,
            "duration": result.get("duration", 0),
            "language": result.get("language", "unknown")
        }
    
    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        raise
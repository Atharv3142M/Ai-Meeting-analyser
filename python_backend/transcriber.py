"""
Advanced Transcription with Speaker Diarization
Implements "stickiness" logic to prevent speaker explosion
"""

import whisper
import logging
import os
import json
from datetime import timedelta

logger = logging.getLogger(__name__)

def format_timestamp(seconds):
    """Convert seconds to HH:MM:SS format"""
    td = timedelta(seconds=seconds)
    hours = td.seconds // 3600
    minutes = (td.seconds % 3600) // 60
    secs = td.seconds % 60
    
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    else:
        return f"{minutes:02d}:{secs:02d}"


def smooth_speaker_diarization(segments, short_segment_threshold=1.0, pause_threshold=2.0):
    """
    Apply smoothing to speaker diarization to prevent "speaker explosion"
    
    Logic:
    - If a segment is very short (< 1s), merge it with the previous speaker
    - If the pause between segments is short (< threshold), keep same speaker
    - Only create new speaker on significant pauses
    
    Args:
        segments: List of segments from Whisper
        short_segment_threshold: Minimum duration (seconds) to consider a segment independent
        pause_threshold: Minimum pause (seconds) to trigger speaker change
    
    Returns:
        List of segments with smoothed speaker labels
    """
    if not segments:
        return []
    
    speaker_segments = []
    current_speaker = 0
    last_end_time = 0
    
    for i, segment in enumerate(segments):
        start_time = segment['start']
        end_time = segment['end']
        duration = end_time - start_time
        pause_duration = start_time - last_end_time
        
        # Decision logic for speaker assignment
        should_change_speaker = False
        
        if i == 0:
            # First segment always gets Speaker 0
            current_speaker = 0
        else:
            # Check if we should create a new speaker
            
            # Rule 1: Long pause suggests speaker change
            if pause_duration > pause_threshold:
                should_change_speaker = True
            
            # Rule 2: Very short segments stay with previous speaker (likely same person)
            # This prevents fragmenting a single speaker's speech
            if duration < short_segment_threshold:
                should_change_speaker = False
            
            if should_change_speaker:
                current_speaker += 1
        
        # Create speaker segment
        speaker_segments.append({
            'speaker': f'Speaker {current_speaker}',
            'start': start_time,
            'end': end_time,
            'duration': duration,
            'text': segment['text'].strip()
        })
        
        last_end_time = end_time
    
    # Further smoothing: Merge isolated single segments
    # If a speaker appears only once surrounded by the same other speaker, merge it
    smoothed_segments = []
    i = 0
    
    while i < len(speaker_segments):
        current = speaker_segments[i]
        
        # Look ahead: Check if this is an isolated segment
        if i > 0 and i < len(speaker_segments) - 1:
            prev_speaker = speaker_segments[i-1]['speaker']
            next_speaker = speaker_segments[i+1]['speaker'] if i+1 < len(speaker_segments) else None
            current_speaker_label = current['speaker']
            
            # If surrounded by same speaker and this segment is short, merge it
            if (prev_speaker == next_speaker and 
                prev_speaker != current_speaker_label and 
                current['duration'] < 2.0):
                # Merge with previous speaker
                current['speaker'] = prev_speaker
        
        smoothed_segments.append(current)
        i += 1
    
    # Renumber speakers consecutively (remove gaps)
    speaker_map = {}
    next_speaker_num = 0
    
    for segment in smoothed_segments:
        old_label = segment['speaker']
        if old_label not in speaker_map:
            speaker_map[old_label] = f'Speaker {next_speaker_num}'
            next_speaker_num += 1
        segment['speaker'] = speaker_map[old_label]
    
    return smoothed_segments


def calculate_speaker_stats(speaker_segments):
    """Calculate statistics for each speaker"""
    stats = {}
    
    for segment in speaker_segments:
        speaker = segment['speaker']
        
        if speaker not in stats:
            stats[speaker] = {
                'segment_count': 0,
                'total_duration': 0,
                'segments': []
            }
        
        stats[speaker]['segment_count'] += 1
        stats[speaker]['total_duration'] += segment['duration']
        stats[speaker]['segments'].append({
            'start': segment['start'],
            'end': segment['end'],
            'text': segment['text']
        })
    
    return stats


def transcribe(audio_file_path):
    """
    Transcribe audio file with advanced speaker diarization
    
    Args:
        audio_file_path: Path to audio file (.wav recommended)
    
    Returns:
        dict: Complete transcript data with speaker identification
    """
    try:
        logger.info(f"Transcribing: {audio_file_path}")
        
        # Validate file
        if not os.path.exists(audio_file_path):
            raise FileNotFoundError(f"Audio file not found: {audio_file_path}")
        
        file_size = os.path.getsize(audio_file_path) / (1024 * 1024)
        logger.info(f"Audio file size: {file_size:.2f}MB")
        
        # Load Whisper model (use GPU if available)
        model_name = "small"  # Can be configured
        logger.info(f"Loading Whisper model: {model_name}")
        model = whisper.load_model(model_name)
        
        # Transcribe with word-level timestamps
        logger.info("Starting transcription (GPU accelerated if available)...")
        result = model.transcribe(
            audio_file_path,
            fp16=False,  # Set to True if GPU has FP16 support
            verbose=False,
            word_timestamps=True,
            language=None  # Auto-detect
        )
        
        segments = result.get("segments", [])
        full_text = result.get("text", "")
        language = result.get("language", "unknown")
        duration = result.get("duration", 0)
        
        logger.info(f"Transcription complete: {len(segments)} segments, {duration:.1f}s duration")
        
        # Apply advanced speaker diarization with smoothing
        logger.info("Applying speaker diarization with smoothing algorithm...")
        speaker_segments = smooth_speaker_diarization(
            segments,
            short_segment_threshold=1.0,
            pause_threshold=2.0
        )
        
        # Calculate speaker statistics
        speaker_stats = calculate_speaker_stats(speaker_segments)
        num_speakers = len(speaker_stats)
        
        logger.info(f"Detected {num_speakers} distinct speakers")
        
        # Format statistics for logging
        for speaker, stats in speaker_stats.items():
            logger.info(
                f"  {speaker}: {stats['segment_count']} segments, "
                f"{stats['total_duration']:.1f}s total speaking time"
            )
        
        # Build complete result
        transcript_result = {
            "full_text": full_text,
            "language": language,
            "duration": duration,
            "num_speakers": num_speakers,
            "segments": speaker_segments,
            "speaker_stats": {
                speaker: {
                    "segment_count": stats['segment_count'],
                    "total_duration": int(stats['total_duration'])
                }
                for speaker, stats in speaker_stats.items()
            }
        }
        
        logger.info("Transcription with diarization complete")
        return transcript_result
    
    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        raise


def format_transcript_for_display(transcript_result):
    """
    Format transcript for readable display
    
    Args:
        transcript_result: Result from transcribe()
    
    Returns:
        Formatted text string
    """
    segments = transcript_result.get('segments', [])
    
    if not segments:
        return "No transcript available."
    
    lines = []
    lines.append("=" * 80)
    lines.append("MEETING TRANSCRIPT WITH SPEAKER IDENTIFICATION")
    lines.append("=" * 80)
    lines.append("")
    
    current_speaker = None
    speaker_text = []
    
    for segment in segments:
        speaker = segment['speaker']
        timestamp = format_timestamp(segment['start'])
        text = segment['text']
        
        if speaker != current_speaker:
            # New speaker - write accumulated text
            if current_speaker and speaker_text:
                lines.append(f"\n{current_speaker}:")
                lines.append(' '.join(speaker_text))
                lines.append("")
            
            current_speaker = speaker
            speaker_text = [f"[{timestamp}] {text}"]
        else:
            # Same speaker - accumulate
            speaker_text.append(text)
    
    # Write last speaker
    if current_speaker and speaker_text:
        lines.append(f"\n{current_speaker}:")
        lines.append(' '.join(speaker_text))
    
    lines.append("")
    lines.append("=" * 80)
    
    # Add statistics
    speaker_stats = transcript_result.get('speaker_stats', {})
    lines.append(f"Total Speakers: {transcript_result.get('num_speakers', 0)}")
    lines.append(f"Total Duration: {format_timestamp(transcript_result.get('duration', 0))}")
    
    for speaker, stats in speaker_stats.items():
        duration_formatted = format_timestamp(stats['total_duration'])
        lines.append(
            f"  {speaker}: {stats['segment_count']} segments, {duration_formatted} total"
        )
    
    lines.append("=" * 80)
    
    return '\n'.join(lines)
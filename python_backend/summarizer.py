"""
AI Summarization Module
Works with structured transcript JSON
"""

import logging
from langchain_ollama import OllamaLLM

logger = logging.getLogger(__name__)


def format_transcript_for_summary(transcript_result):
    """
    Format transcript JSON for LLM input
    
    Args:
        transcript_result: Dictionary from transcriber.transcribe()
    
    Returns:
        Formatted string for LLM
    """
    segments = transcript_result.get('segments', [])
    
    if not segments:
        return "No transcript available."
    
    lines = []
    current_speaker = None
    speaker_lines = []
    
    for segment in segments:
        speaker = segment['speaker']
        text = segment['text']
        
        if speaker != current_speaker:
            if current_speaker and speaker_lines:
                lines.append(f"{current_speaker}: {' '.join(speaker_lines)}")
            current_speaker = speaker
            speaker_lines = [text]
        else:
            speaker_lines.append(text)
    
    # Add last speaker
    if current_speaker and speaker_lines:
        lines.append(f"{current_speaker}: {' '.join(speaker_lines)}")
    
    return '\n\n'.join(lines)


def create_summary_prompt(transcript_text, num_speakers):
    """
    Create enhanced prompt for LLM
    
    Args:
        transcript_text: Formatted transcript text
        num_speakers: Number of speakers detected
    
    Returns:
        Prompt string
    """
    if num_speakers > 1:
        prompt = f"""You are an expert meeting analyst. Analyze this meeting transcript with {num_speakers} identified speakers.

TRANSCRIPT:
{transcript_text}

Provide a comprehensive analysis in the following structure:

1. EXECUTIVE SUMMARY
Write a concise 2-3 sentence overview of the meeting's purpose and outcomes.

2. KEY DISCUSSION POINTS
List the main topics discussed in order of importance. For each point, indicate which speaker(s) were primarily involved.

3. SPEAKER CONTRIBUTIONS
For each speaker identified in the transcript:
- Speaker 0: Summarize their main points and role in the discussion
- Speaker 1: Summarize their main points and role in the discussion
(Continue for all speakers)

4. DECISIONS MADE
List any decisions, agreements, or conclusions reached during the meeting.

5. ACTION ITEMS
Extract all action items, tasks, or follow-ups mentioned. Format as:
- Task description [Owner if mentioned] [Deadline if mentioned]

6. OPEN QUESTIONS
List any unresolved questions or topics that require further discussion.

7. NEXT STEPS
Summarize what should happen after this meeting.

Format your response with clear headers and bullet points."""
    else:
        prompt = f"""You are an expert content analyst. Analyze this audio transcript.

TRANSCRIPT:
{transcript_text}

Provide a comprehensive analysis in the following structure:

1. EXECUTIVE SUMMARY
Write a concise 2-3 sentence overview of the content.

2. KEY POINTS
List the main topics or themes discussed in order of importance.

3. IMPORTANT HIGHLIGHTS
Extract the most significant statements, insights, or information.

4. ACTION ITEMS (if any)
List any tasks, follow-ups, or actionable items mentioned.

5. CONCLUSIONS
Summarize the main takeaways or conclusions.

Format your response with clear headers and bullet points."""
    
    return prompt


def summarize_from_transcript(transcript_result):
    """
    Generate AI summary from transcript result
    
    Args:
        transcript_result: Dictionary from transcriber.transcribe()
    
    Returns:
        dict: Summary result with metadata
    """
    try:
        logger.info("Starting AI summarization...")
        
        # Extract data
        num_speakers = transcript_result.get('num_speakers', 1)
        duration = transcript_result.get('duration', 0)
        language = transcript_result.get('language', 'unknown')
        
        # Format transcript for LLM
        transcript_text = format_transcript_for_summary(transcript_result)
        
        if not transcript_text or transcript_text == "No transcript available.":
            raise ValueError("Empty transcript")
        
        # Initialize LLM
        model_name = "llama3"  # Can be configured
        logger.info(f"Loading Ollama model: {model_name}")
        
        try:
            llm = OllamaLLM(
                model=model_name,
                temperature=0.3  # Lower for more focused summaries
            )
        except Exception as e:
            logger.error(f"Failed to load Ollama model: {e}")
            raise RuntimeError(
                f"Could not connect to Ollama. "
                f"Ensure Ollama is running and model '{model_name}' is installed. "
                f"Install with: ollama pull {model_name}"
            )
        
        # Create prompt
        prompt = create_summary_prompt(transcript_text, num_speakers)
        
        # Generate summary
        logger.info("Generating summary (this may take 30-60 seconds)...")
        summary = llm.invoke(prompt)
        
        logger.info("Summary generation complete")
        
        # Build result
        result = {
            "summary": summary,
            "model_used": model_name,
            "num_speakers": num_speakers,
            "duration": duration,
            "language": language
        }
        
        return result
    
    except Exception as e:
        logger.error(f"Summarization error: {e}", exc_info=True)
        raise


def format_summary_for_display(summary_result):
    """
    Format summary for display
    
    Args:
        summary_result: Result from summarize_from_transcript()
    
    Returns:
        Formatted string
    """
    lines = []
    lines.append("=" * 80)
    lines.append("MEETING SUMMARY & ANALYSIS")
    lines.append("=" * 80)
    lines.append("")
    
    # Metadata
    num_speakers = summary_result.get('num_speakers', 0)
    duration = summary_result.get('duration', 0)
    language = summary_result.get('language', 'unknown')
    
    lines.append(f"Speakers Detected: {num_speakers}")
    lines.append(f"Duration: {int(duration // 60)}m {int(duration % 60)}s")
    lines.append(f"Language: {language}")
    lines.append("")
    lines.append("=" * 80)
    lines.append("")
    
    # Summary content
    lines.append(summary_result.get('summary', ''))
    
    lines.append("")
    lines.append("=" * 80)
    lines.append(f"Generated by: {summary_result.get('model_used', 'unknown')}")
    lines.append("=" * 80)
    
    return '\n'.join(lines)
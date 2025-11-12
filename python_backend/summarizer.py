import yaml
import os
import logging
from langchain_ollama import OllamaLLM
from langchain.prompts import PromptTemplate
import json

logger = logging.getLogger(__name__)

def load_config():
    """Load configuration from YAML file"""
    try:
        with open("config.yaml", "r") as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        logger.warning("config.yaml not found, using defaults")
        return {"ollama": {"model": "llama3"}}

def extract_speakers_info(transcript_text):
    """
    Extract speaker information from transcript if available
    
    Args:
        transcript_text: Full transcript text
    
    Returns:
        dict: Speaker information or None
    """
    speakers = []
    lines = transcript_text.split('\n')
    
    for line in lines:
        if line.startswith('Speaker ') and ':' in line:
            speaker = line.split(':')[0].strip()
            if speaker not in speakers:
                speakers.append(speaker)
    
    if speakers:
        return {
            "speakers_found": True,
            "speaker_count": len(speakers),
            "speakers": speakers
        }
    return {"speakers_found": False}

def create_summary_prompt(transcript_text, speaker_info):
    """
    Create an enhanced prompt based on whether speakers are identified
    
    Args:
        transcript_text: The full transcript
        speaker_info: Dictionary containing speaker information
    
    Returns:
        str: Formatted prompt
    """
    if speaker_info.get("speakers_found"):
        prompt = f"""You are an expert meeting analyst. Analyze this meeting transcript with identified speakers.

TRANSCRIPT:
{transcript_text}

ANALYSIS REQUIRED:

1. EXECUTIVE SUMMARY
Provide a concise 2-3 sentence overview of the meeting's purpose and outcomes.

2. KEY DISCUSSION POINTS
List the main topics discussed, organized by importance.

3. SPEAKER CONTRIBUTIONS
For each speaker identified, summarize their main points and contributions.

4. DECISIONS MADE
List any decisions that were made during the meeting.

5. ACTION ITEMS
Extract all action items, tasks, or follow-ups mentioned. For each, identify:
- What needs to be done
- Who is responsible (if mentioned)
- Deadline (if mentioned)

6. OPEN QUESTIONS
List any unresolved questions or topics that need further discussion.

7. NEXT STEPS
Summarize what should happen after this meeting.

Format your response in a clear, structured manner with headers and bullet points."""
    else:
        prompt = f"""You are an expert meeting analyst. Analyze this meeting transcript.

TRANSCRIPT:
{transcript_text}

ANALYSIS REQUIRED:

1. EXECUTIVE SUMMARY
Provide a concise 2-3 sentence overview of the meeting's purpose and outcomes.

2. KEY DISCUSSION POINTS
List the main topics discussed in order of importance.

3. DECISIONS MADE
List any decisions that were made during the meeting.

4. ACTION ITEMS
Extract all action items, tasks, or follow-ups mentioned. For each action item, include:
- What needs to be done
- Who is responsible (if mentioned)
- Deadline (if mentioned)

5. IMPORTANT HIGHLIGHTS
List key quotes, insights, or important statements made during the meeting.

6. OPEN QUESTIONS
List any unresolved questions or topics that need further discussion.

7. NEXT STEPS
Summarize what should happen after this meeting.

Format your response in a clear, structured manner with headers and bullet points."""
    
    return prompt

def summarize(transcript_file, summary_file=None):
    """
    Summarize a meeting transcript using Ollama LLM with enhanced analysis.
    
    Args:
        transcript_file (str): Path to the transcript text file.
        summary_file (str, optional): Path to save the meeting summary. 
            If None, generates a filename based on transcript file.
            
    Returns:
        dict: Dictionary containing summary information
    """
    try:
        # Validate input file
        if not os.path.exists(transcript_file):
            raise FileNotFoundError(f"Transcript file not found: {transcript_file}")
        
        # Load configuration
        cfg = load_config()
        model_name = cfg.get("ollama", {}).get("model", "llama3")
        
        logger.info(f"Loading Ollama model '{model_name}'...")
        
        # Initialize LLM
        try:
            llm = OllamaLLM(
                model=model_name,
                temperature=0.3  # Lower temperature for more focused summaries
            )
        except Exception as e:
            logger.error(f"Failed to load Ollama model: {e}")
            raise RuntimeError(
                f"Could not connect to Ollama. "
                f"Ensure Ollama is running and model '{model_name}' is installed. "
                f"Install with: ollama pull {model_name}"
            )
        
        # Generate summary file name if not provided
        if summary_file is None:
            base_name = os.path.splitext(os.path.basename(transcript_file))[0]
            base_name = base_name.replace("_transcript", "")
            summary_file = f"{base_name}_summary.txt"
        
        logger.info("Reading transcript...")
        with open(transcript_file, "r", encoding="utf-8") as f:
            transcript_text = f.read()
        
        if not transcript_text.strip():
            raise ValueError("Transcript file is empty")
        
        # Extract speaker information
        speaker_info = extract_speakers_info(transcript_text)
        logger.info(f"Speaker detection: {speaker_info}")
        
        # Create enhanced prompt
        prompt = create_summary_prompt(transcript_text, speaker_info)
        
        logger.info("Generating AI summary (this may take a minute)...")
        
        # Generate summary
        try:
            summary = llm.invoke(prompt)
        except Exception as e:
            logger.error(f"LLM invocation failed: {e}")
            raise RuntimeError(f"Failed to generate summary: {e}")
        
        # Format final output
        output_lines = []
        output_lines.append("=" * 80)
        output_lines.append("MEETING SUMMARY & ANALYSIS")
        output_lines.append("=" * 80)
        output_lines.append("")
        
        if speaker_info.get("speakers_found"):
            output_lines.append(f"Participants Detected: {speaker_info['speaker_count']}")
            output_lines.append(f"Speakers: {', '.join(speaker_info['speakers'])}")
            output_lines.append("")
        
        output_lines.append(summary)
        output_lines.append("")
        output_lines.append("=" * 80)
        output_lines.append(f"Generated by: {model_name}")
        output_lines.append("=" * 80)
        
        # Save summary
        logger.info(f"Saving summary to: {summary_file}")
        with open(summary_file, "w", encoding="utf-8") as f:
            f.write('\n'.join(output_lines))
        
        # Save metadata
        json_file = summary_file.replace('.txt', '_metadata.json')
        metadata = {
            "transcript_file": os.path.basename(transcript_file),
            "model_used": model_name,
            "speakers_detected": speaker_info.get("speaker_count", 0),
            "has_speaker_identification": speaker_info.get("speakers_found", False)
        }
        
        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
        
        logger.info(f"Metadata saved to: {json_file}")
        logger.info("Summary generation complete.")
        
        return {
            "summary_path": summary_file,
            "metadata_path": json_file,
            "model_used": model_name,
            "speakers_detected": speaker_info.get("speaker_count", 0)
        }
    
    except Exception as e:
        logger.error(f"Summarization error: {e}", exc_info=True)
        raise
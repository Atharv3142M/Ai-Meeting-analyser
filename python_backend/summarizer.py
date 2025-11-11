import yaml
import os
from langchain_ollama import OllamaLLM

def load_config():
    with open("config.yaml", "r") as f:
        return yaml.safe_load(f)

def summarize(transcript_file, summary_file=None):
    """
    Summarize a meeting transcript using Ollama LLM.
    
    Args:
        transcript_file (str): Path to the transcript text file.
        summary_file (str, optional): Path to save the meeting summary. 
            If None, generates a filename based on transcript file.
            
    Returns:
        str: Path to the saved summary file.
    """
    cfg = load_config()
    model_name = cfg["ollama"].get("model", "llama3")
    print(f"Loading Ollama model '{model_name}'...")
    llm = OllamaLLM(model=model_name)

    # Generate summary file name if not provided
    if summary_file is None:
        base_name = os.path.splitext(os.path.basename(transcript_file))[0].replace("_transcript", "")
        summary_file = f"{base_name}_meeting_summary.txt"

    print("Reading transcript...")
    with open(transcript_file, "r", encoding="utf-8") as f:
        text = f.read()

    # Improved prompt
    prompt = f"""
    You are a professional assistant. Summarize the following meeting transcript.
    Provide a concise executive summary, followed by a list of key points and any action items.

    Transcript:
    {text}
    """
    
    print("Generating summary...")
    summary = llm.invoke(prompt)

    with open(summary_file, "w", encoding="utf-8") as f:
        f.write(summary)
    
    print("Summary complete.")
    return summary_file
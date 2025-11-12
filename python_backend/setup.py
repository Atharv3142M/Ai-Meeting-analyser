#!/usr/bin/env python3
"""
Local AI Recorder - Setup Script
Helps verify and install all required dependencies
"""

import sys
import subprocess
import os
import platform

def print_header(text):
    """Print a formatted header"""
    print("\n" + "=" * 70)
    print(f"  {text}")
    print("=" * 70 + "\n")

def check_python_version():
    """Check if Python version is compatible"""
    print_header("Checking Python Version")
    
    version = sys.version_info
    print(f"Python Version: {version.major}.{version.minor}.{version.micro}")
    
    if version.major < 3 or (version.major == 3 and version.minor < 8):
        print("❌ ERROR: Python 3.8 or higher is required")
        print("Please upgrade Python: https://www.python.org/downloads/")
        return False
    
    print("✅ Python version is compatible")
    return True

def check_ffmpeg():
    """Check if FFmpeg is installed"""
    print_header("Checking FFmpeg")
    
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            print(f"✅ FFmpeg found: {version_line}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    print("❌ FFmpeg not found")
    print("\nFFmpeg is required for Whisper to process audio files.")
    print("\nInstallation instructions:")
    
    system = platform.system()
    if system == "Windows":
        print("  1. Download from: https://ffmpeg.org/download.html")
        print("  2. Extract to C:\\ffmpeg")
        print("  3. Add C:\\ffmpeg\\bin to your PATH")
    elif system == "Darwin":  # macOS
        print("  Run: brew install ffmpeg")
    else:  # Linux
        print("  Run: sudo apt-get install ffmpeg")
    
    return False

def check_ollama():
    """Check if Ollama is installed and running"""
    print_header("Checking Ollama")
    
    try:
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            print("✅ Ollama is installed")
            
            if result.stdout.strip():
                print("\nInstalled models:")
                for line in result.stdout.strip().split('\n')[1:]:  # Skip header
                    print(f"  - {line.split()[0]}")
                return True
            else:
                print("\n⚠️  No models installed")
                print("Install llama3: ollama pull llama3")
                return False
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    print("❌ Ollama not found")
    print("\nOllama is required for AI summarization.")
    print("Download from: https://ollama.ai")
    return False

def install_requirements():
    """Install Python requirements"""
    print_header("Installing Python Dependencies")
    
    if not os.path.exists("requirements.txt"):
        print("❌ requirements.txt not found!")
        return False
    
    print("Installing packages (this may take several minutes)...")
    
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", "requirements.txt"],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print("✅ All Python packages installed successfully")
            return True
        else:
            print("❌ Installation failed:")
            print(result.stderr)
            return False
    except Exception as e:
        print(f"❌ Installation error: {e}")
        return False

def create_directories():
    """Create necessary directories"""
    print_header("Creating Directories")
    
    directories = ["videos", "transcribe", "summary", "logs"]
    
    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        print(f"✅ Created: {directory}/")
    
    return True

def verify_config():
    """Verify config.yaml exists"""
    print_header("Checking Configuration")
    
    if os.path.exists("config.yaml"):
        print("✅ config.yaml found")
        return True
    else:
        print("❌ config.yaml not found")
        print("Creating default config.yaml...")
        
        default_config = """# Local AI Recorder Configuration
transcription:
  model: "small"
  language: "auto"

diarization:
  enabled: true
  min_speakers: 1
  max_speakers: 10
  pause_threshold: 2.0

ollama:
  model: "llama3"
  temperature: 0.3
  style: "detailed"

server:
  host: "127.0.0.1"
  port: 5000
  max_file_size_mb: 500
  enable_cors: true

output:
  include_timestamps: true
  include_speakers: true
  save_metadata: true
  auto_open_summary: false

performance:
  whisper_threads: 0
  use_gpu: false
  batch_size: 16

logging:
  level: "INFO"
  retention_days: 30
  max_log_size_mb: 10
"""
        
        with open("config.yaml", "w") as f:
            f.write(default_config)
        
        print("✅ Created default config.yaml")
        return True

def run_setup():
    """Run the complete setup process"""
    print("\n" + "=" * 70)
    print("  LOCAL AI RECORDER - SETUP WIZARD")
    print("  Version 2.1.0")
    print("=" * 70)
    
    results = []
    
    # Step 1: Check Python
    results.append(("Python Version", check_python_version()))
    
    # Step 2: Check FFmpeg
    results.append(("FFmpeg", check_ffmpeg()))
    
    # Step 3: Check Ollama
    results.append(("Ollama", check_ollama()))
    
    # Step 4: Create directories
    results.append(("Directories", create_directories()))
    
    # Step 5: Verify config
    results.append(("Configuration", verify_config()))
    
    # Step 6: Install Python packages
    print("\nDo you want to install Python dependencies now? (y/n): ", end="")
    response = input().strip().lower()
    
    if response == 'y':
        results.append(("Python Packages", install_requirements()))
    else:
        print("⚠️  Skipped Python package installation")
        print("Run manually: pip install -r requirements.txt")
        results.append(("Python Packages", None))
    
    # Print summary
    print_header("SETUP SUMMARY")
    
    for component, status in results:
        if status is True:
            print(f"✅ {component}: Ready")
        elif status is False:
            print(f"❌ {component}: Issues found")
        else:
            print(f"⚠️  {component}: Skipped")
    
    all_ready = all(s is True for s in [r[1] for r in results if r[1] is not None])
    
    print("\n" + "=" * 70)
    
    if all_ready:
        print("🎉 Setup Complete! You're ready to start recording.")
        print("\nNext steps:")
        print("  1. Start the server: python server.py")
        print("  2. Load the Chrome extension")
        print("  3. Start recording meetings!")
    else:
        print("⚠️  Setup incomplete. Please resolve the issues above.")
        print("\nFor help, visit the documentation or check the README.md")
    
    print("=" * 70 + "\n")

if __name__ == "__main__":
    try:
        run_setup()
    except KeyboardInterrupt:
        print("\n\nSetup cancelled by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Setup failed with error: {e}")
        sys.exit(1)
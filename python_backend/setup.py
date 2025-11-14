#!/usr/bin/env python3
"""
POAi v2.0 - Production Setup & Launcher
Verifies dependencies and launches the server
"""

import sys
import os
import subprocess
import platform
from pathlib import Path

class Colors:
    """ANSI color codes for terminal output"""
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'

def print_banner():
    """Print POAi startup banner"""
    banner = f"""
{Colors.CYAN}{'='*70}
  _____   ____          _    _ 
 |  __ \ / __ \   /\   (_)  | |
 | |__) | |  | | /  \   _   | |
 |  ___/| |  | |/ /\ \ | |  | |
 | |    | |__| / ____ \| | _| |_
 |_|     \____/_/    \_\_|(_)___/
                                  
 Productivity Optimization Assistant AI v2.0
 Production Build with MongoDB & Video Support
{'='*70}{Colors.END}
"""
    print(banner)

def check_python_version():
    """Check if Python version is 3.11+"""
    print(f"\n{Colors.BOLD}[1/6] Checking Python Version...{Colors.END}")
    version = sys.version_info
    
    print(f"  Python Version: {version.major}.{version.minor}.{version.micro}")
    
    if version.major < 3 or (version.major == 3 and version.minor < 11):
        print(f"  {Colors.RED}✗ ERROR: Python 3.11+ required{Colors.END}")
        print(f"  Current: {version.major}.{version.minor}.{version.micro}")
        print(f"  Download: https://www.python.org/downloads/")
        return False
    
    print(f"  {Colors.GREEN}✓ Python version OK{Colors.END}")
    return True

def check_ffmpeg():
    """Check if FFmpeg is installed and in PATH"""
    print(f"\n{Colors.BOLD}[2/6] Checking FFmpeg...{Colors.END}")
    
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            print(f"  {Colors.GREEN}✓ FFmpeg found: {version_line}{Colors.END}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    print(f"  {Colors.RED}✗ FFmpeg not found{Colors.END}")
    print(f"\n  Installation:")
    
    system = platform.system()
    if system == "Windows":
        print(f"    1. Download: https://ffmpeg.org/download.html")
        print(f"    2. Extract to C:\\ffmpeg")
        print(f"    3. Add C:\\ffmpeg\\bin to PATH")
        print(f"    Or: choco install ffmpeg")
    elif system == "Darwin":
        print(f"    Run: brew install ffmpeg")
    else:
        print(f"    Run: sudo apt-get install ffmpeg")
    
    return False

def check_ollama():
    """Check if Ollama is installed and running"""
    print(f"\n{Colors.BOLD}[3/6] Checking Ollama...{Colors.END}")
    
    try:
        result = subprocess.run(
            ['ollama', 'list'],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            print(f"  {Colors.GREEN}✓ Ollama is running{Colors.END}")
            
            # Check for models
            if result.stdout.strip():
                print(f"\n  Installed models:")
                for line in result.stdout.strip().split('\n')[1:]:
                    if line.strip():
                        model_name = line.split()[0]
                        print(f"    - {model_name}")
                return True
            else:
                print(f"  {Colors.YELLOW}⚠ No models installed{Colors.END}")
                print(f"  Run: ollama pull llama3")
                return False
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    print(f"  {Colors.RED}✗ Ollama not found or not running{Colors.END}")
    print(f"\n  Installation:")
    print(f"    1. Download: https://ollama.ai")
    print(f"    2. Install and start service")
    print(f"    3. Run: ollama pull llama3")
    
    return False

def check_mongodb():
    """Check if MongoDB is installed and running"""
    print(f"\n{Colors.BOLD}[4/6] Checking MongoDB...{Colors.END}")
    
    try:
        import pymongo
        
        # Try to connect to local MongoDB
        client = pymongo.MongoClient(
            'mongodb://localhost:27017/',
            serverSelectionTimeoutMS=3000
        )
        
        # Force connection attempt
        client.server_info()
        
        print(f"  {Colors.GREEN}✓ MongoDB is running on localhost:27017{Colors.END}")
        
        # Check database
        db = client['poai_db']
        collections = db.list_collection_names()
        
        if collections:
            print(f"  Database 'poai_db' found with collections:")
            for coll in collections:
                print(f"    - {coll}")
        else:
            print(f"  Database 'poai_db' will be created on first run")
        
        client.close()
        return True
        
    except ImportError:
        print(f"  {Colors.YELLOW}⚠ pymongo not installed{Colors.END}")
        print(f"  Will be installed with requirements.txt")
        return None  # Not critical, will be installed
        
    except Exception as e:
        print(f"  {Colors.RED}✗ MongoDB not running or not accessible{Colors.END}")
        print(f"\n  Installation:")
        
        system = platform.system()
        if system == "Windows":
            print(f"    1. Download: https://www.mongodb.com/try/download/community")
            print(f"    2. Install MongoDB Community Server")
            print(f"    3. Start MongoDB service:")
            print(f"       net start MongoDB")
        elif system == "Darwin":
            print(f"    Run: brew install mongodb-community")
            print(f"         brew services start mongodb-community")
        else:
            print(f"    Run: sudo apt-get install mongodb")
            print(f"         sudo systemctl start mongod")
        
        print(f"\n  Or use Docker:")
        print(f"    docker run -d -p 27017:27017 --name mongodb mongo:latest")
        
        return False

def install_requirements():
    """Install Python requirements"""
    print(f"\n{Colors.BOLD}[5/6] Python Dependencies...{Colors.END}")
    
    if not os.path.exists('requirements.txt'):
        print(f"  {Colors.RED}✗ requirements.txt not found{Colors.END}")
        return False
    
    response = input(f"  Install/update dependencies? (y/n): ").lower()
    
    if response == 'y':
        print(f"\n  Installing packages (this may take a few minutes)...")
        
        try:
            # Install PyTorch first for Windows CUDA support
            if platform.system() == "Windows":
                print(f"  Installing PyTorch with CUDA support...")
                subprocess.run(
                    [sys.executable, '-m', 'pip', 'install', 'torch', 'torchaudio',
                     '--index-url', 'https://download.pytorch.org/whl/cu118'],
                    check=True
                )
            
            # Install other requirements
            result = subprocess.run(
                [sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'],
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0:
                print(f"  {Colors.GREEN}✓ All packages installed{Colors.END}")
                return True
            else:
                print(f"  {Colors.RED}✗ Installation failed{Colors.END}")
                print(result.stderr)
                return False
                
        except Exception as e:
            print(f"  {Colors.RED}✗ Installation error: {e}{Colors.END}")
            return False
    else:
        print(f"  {Colors.YELLOW}⚠ Skipped{Colors.END}")
        return None

def create_directories():
    """Create necessary directories"""
    print(f"\n{Colors.BOLD}[6/6] Creating Directories...{Colors.END}")
    
    directories = ['videos', 'audio', 'compressed', 'logs', 'templates', 'static']
    
    for directory in directories:
        Path(directory).mkdir(exist_ok=True)
        print(f"  {Colors.GREEN}✓{Colors.END} {directory}/")
    
    return True

def launch_server():
    """Launch the POAi server"""
    print(f"\n{Colors.BOLD}{'='*70}{Colors.END}")
    print(f"{Colors.BOLD}Setup Complete!{Colors.END}")
    print(f"{Colors.BOLD}{'='*70}{Colors.END}\n")
    
    response = input(f"Start POAi server now? (y/n): ").lower()
    
    if response == 'y':
        print(f"\n{Colors.CYAN}Starting POAi server...{Colors.END}")
        print(f"Dashboard: {Colors.BOLD}http://127.0.0.1:5000{Colors.END}")
        print(f"Press Ctrl+C to stop\n")
        print(f"{Colors.BOLD}{'='*70}{Colors.END}\n")
        
        try:
            if platform.system() == "Windows":
                # Launch in new window on Windows
                subprocess.Popen(
                    [sys.executable, 'server.py'],
                    creationflags=subprocess.CREATE_NEW_CONSOLE
                )
                print(f"{Colors.GREEN}✓ Server launched in new window{Colors.END}")
            else:
                # Launch in same terminal on Unix
                subprocess.run([sys.executable, 'server.py'])
        
        except KeyboardInterrupt:
            print(f"\n{Colors.YELLOW}Server stopped by user{Colors.END}")
        except Exception as e:
            print(f"{Colors.RED}Error launching server: {e}{Colors.END}")
    else:
        print(f"\n{Colors.CYAN}To start manually, run:{Colors.END}")
        print(f"  python server.py")

def main():
    """Main setup routine"""
    print_banner()
    
    results = {}
    
    # Run all checks
    results['python'] = check_python_version()
    results['ffmpeg'] = check_ffmpeg()
    results['ollama'] = check_ollama()
    results['mongodb'] = check_mongodb()
    results['packages'] = install_requirements()
    results['directories'] = create_directories()
    
    # Summary
    print(f"\n{Colors.BOLD}{'='*70}{Colors.END}")
    print(f"{Colors.BOLD}SETUP SUMMARY{Colors.END}")
    print(f"{Colors.BOLD}{'='*70}{Colors.END}\n")
    
    for component, status in results.items():
        icon = "✓" if status else ("⚠" if status is None else "✗")
        color = Colors.GREEN if status else (Colors.YELLOW if status is None else Colors.RED)
        status_text = "OK" if status else ("Skipped" if status is None else "Issues")
        
        print(f"  {color}{icon}{Colors.END} {component.capitalize()}: {status_text}")
    
    # Check if critical components are ready
    critical = ['python', 'ffmpeg', 'mongodb']
    all_critical_ready = all(results.get(k) for k in critical if results.get(k) is not None)
    
    if all_critical_ready and results['ollama']:
        launch_server()
    else:
        print(f"\n{Colors.YELLOW}⚠ Please resolve issues above before starting POAi{Colors.END}")
        print(f"\n{Colors.CYAN}Once resolved, run:{Colors.END}")
        print(f"  python setup.py")

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Setup cancelled by user{Colors.END}")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n{Colors.RED}Setup failed: {e}{Colors.END}")
        sys.exit(1)
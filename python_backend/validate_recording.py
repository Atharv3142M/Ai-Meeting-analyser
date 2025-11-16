#!/usr/bin/env python3
"""
POAi File Validator
Checks if recorded WebM files are valid before processing
"""

import os
import sys
import subprocess

def validate_webm_file(filepath):
    """
    Validate a WebM file for integrity
    
    Returns:
        tuple: (is_valid, error_message)
    """
    print(f"\n{'='*60}")
    print(f"Validating: {filepath}")
    print(f"{'='*60}\n")
    
    # Check if file exists
    if not os.path.exists(filepath):
        return False, "File does not exist"
    
    # Check file size
    file_size = os.path.getsize(filepath)
    file_size_mb = file_size / (1024 * 1024)
    
    print(f"File size: {file_size:,} bytes ({file_size_mb:.2f} MB)")
    
    if file_size == 0:
        return False, "File is empty (0 bytes)"
    
    if file_size < 10000:
        return False, f"File too small ({file_size} bytes) - likely corrupted"
    
    # Check WebM magic bytes
    print("\nChecking file header...")
    with open(filepath, 'rb') as f:
        header = f.read(4)
        
    if len(header) < 4:
        return False, "File too short to have valid header"
    
    # WebM/MKV signature: 0x1A 0x45 0xDF 0xA3
    expected_sig = bytes([0x1A, 0x45, 0xDF, 0xA3])
    
    print(f"First 4 bytes: {' '.join(f'{b:02X}' for b in header)}")
    print(f"Expected:      {' '.join(f'{b:02X}' for b in expected_sig)}")
    
    if header != expected_sig:
        return False, f"Invalid WebM header. Expected {expected_sig.hex()}, got {header.hex()}"
    
    print("✓ Valid WebM header detected")
    
    # Use ffprobe to validate file structure
    print("\nRunning ffprobe validation...")
    
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'format=duration,size,bit_rate',
                '-show_entries', 'stream=codec_type,codec_name',
                '-of', 'default=noprint_wrappers=1',
                filepath
            ],
            capture_output=True,
            text=True,
            timeout=30,
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode != 0:
            error_output = result.stderr.strip()
            if "EBML header parsing failed" in error_output:
                return False, "EBML header parsing failed - file is corrupted"
            if "Invalid data found" in error_output:
                return False, "Invalid data found - file structure is broken"
            return False, f"ffprobe validation failed: {error_output[:200]}"
        
        print("ffprobe output:")
        print(result.stdout)
        
        # Parse output
        has_video = 'codec_type=video' in result.stdout
        has_audio = 'codec_type=audio' in result.stdout
        
        print(f"\n✓ Has video stream: {has_video}")
        print(f"✓ Has audio stream: {has_audio}")
        
        if not has_video and not has_audio:
            return False, "No video or audio streams found"
        
        return True, "File is valid"
        
    except FileNotFoundError:
        return False, "ffprobe not found. Install FFmpeg."
    except subprocess.TimeoutExpired:
        return False, "ffprobe timeout - file may be corrupted"
    except Exception as e:
        return False, f"ffprobe error: {str(e)}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python validate_recording.py <path_to_webm_file>")
        print("\nExample:")
        print("  python validate_recording.py videos/my_recording.webm")
        sys.exit(1)
    
    filepath = sys.argv[1]
    
    is_valid, message = validate_webm_file(filepath)
    
    print(f"\n{'='*60}")
    if is_valid:
        print(f"✓ RESULT: File is VALID")
        print(f"  {message}")
        print(f"{'='*60}\n")
        sys.exit(0)
    else:
        print(f"✗ RESULT: File is INVALID")
        print(f"  {message}")
        print(f"{'='*60}\n")
        print("Possible causes:")
        print("  1. Recording was stopped too quickly")
        print("  2. Browser didn't finish writing the file")
        print("  3. MediaRecorder didn't properly finalize")
        print("  4. File was corrupted during upload")
        print("\nTry:")
        print("  - Recording for at least 10 seconds")
        print("  - Waiting 2-3 seconds before stopping")
        print("  - Using a different browser")
        print("  - Checking browser console for errors")
        sys.exit(1)

if __name__ == '__main__':
    main()
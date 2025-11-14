# 🚀 POAi v2.0 - Productivity Optimization Assistant AI

> **Production-grade, local-first meeting recorder with AI-powered analysis**

[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-NoSQL-green.svg)](https://www.mongodb.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🌟 What's New in v2.0

### 🐛 **Critical Bug Fixes**

1. ✅ **File Corruption Fixed** - Proper `recorder.onstop` handling prevents EBML header errors
2. ✅ **Video Recording Fixed** - Now captures video + audio (not just audio)
3. ✅ **Silent Tab Fixed** - Audio monitoring enabled (you CAN hear the meeting)
4. ✅ **Speaker Explosion Fixed** - Smoothing algorithm prevents detecting 10+ speakers for 2 people

### 🎯 **New Features**

- **MongoDB NoSQL Database** - Scalable, flexible document storage
- **Auto-Setup Launcher** - `setup.py` verifies all dependencies
- **Professional Dark UI** - Modern, responsive dashboard
- **Better Error Handling** - Modals instead of alert() dialogs
- **Real-time Status** - Live processing updates
- **Speaker Renaming** - Click to rename "Speaker 0" → "Alice"

---

## 📋 Quick Start

### One-Command Setup

```bash
# Navigate to project folder
cd poai_v2

# Run setup (checks everything automatically)
python setup.py
```

The setup script will:
- ✅ Check Python 3.11+
- ✅ Check FFmpeg
- ✅ Check Ollama
- ✅ Check MongoDB
- ✅ Install dependencies
- ✅ Create directories
- ✅ Launch server

---

## 🔧 Prerequisites

### Required Software

| Software | Version | Purpose | Install |
|----------|---------|---------|---------|
| **Python** | 3.11+ | Backend runtime | [python.org](https://python.org) |
| **FFmpeg** | Latest | Video processing | [ffmpeg.org](https://ffmpeg.org) |
| **MongoDB** | 4.0+ | Database | [mongodb.com](https://mongodb.com) |
| **Ollama** | Latest | AI summarization | [ollama.ai](https://ollama.ai) |
| **Chrome** | Latest | Extension | [google.com/chrome](https://google.com/chrome) |

### Optional (Recommended)

- **NVIDIA GPU** with CUDA 11.8 (10x faster transcription)
- **16GB RAM** (8GB minimum)

---

## 📦 Installation

### Step 1: Install Prerequisites

**MongoDB:**
```bash
# Windows (download installer)
https://www.mongodb.com/try/download/community

# Or Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Start service (Windows)
net start MongoDB
```

**FFmpeg:**
```bash
# Windows (Chocolatey)
choco install ffmpeg

# Or download from ffmpeg.org and add to PATH
```

**Ollama:**
```bash
# Download from ollama.ai
# Then pull model:
ollama pull llama3
```

### Step 2: Run Setup

```bash
python setup.py
```

### Step 3: Install Chrome Extension

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `chrome_extension` folder

---

## 🎯 Usage

### Recording a Meeting

1. **Start Server**
   ```bash
   python server.py
   ```
   Opens at: http://127.0.0.1:5000

2. **Start Recording**
   - Join meeting (Zoom, Meet, Teams, etc.)
   - Click POAi extension icon
   - Enter recording name
   - Click "Start Recording"
   - **Select correct tab** in permission dialog
   - Grant microphone access

3. **During Recording**
   - ✅ You CAN hear the meeting (audio monitoring)
   - 🔴 Red dot shows recording active
   - Tab must stay open

4. **Stop Recording**
   - Click extension icon
   - Click "Finish Recording"
   - Automatic upload to server

5. **View Results**
   - Open http://127.0.0.1:5000
   - Processing happens in background
   - Click recording when completed

### Using the Dashboard

**Gallery View:**
- Grid of all recordings
- Status indicators (processing/completed/failed)
- Click to open player

**Player View:**
- Left: Video player
- Right: Interactive transcript (click text to jump)
- Tabs: Transcript / AI Summary
- Bottom: Speaker management

**Speaker Renaming:**
1. Scroll to "Speaker Management"
2. Click speaker button
3. Enter real name (e.g., "Alice Johnson")
4. Save

---

## 🏗️ Architecture

### System Components

```
┌─────────────────────────────────────────┐
│     Chrome Extension (Recording)        │
│  ┌────────┐  ┌──────────┐  ┌─────────┐ │
│  │popup.js│→ │background│→ │offscreen│ │
│  │  (UI)  │  │   .js    │  │   .js   │ │
│  └────────┘  └──────────┘  └─────────┘ │
└──────────────────┬──────────────────────┘
                   │ Upload .webm
                   ↓
┌─────────────────────────────────────────┐
│   Python Backend (Flask + MongoDB)      │
│  ┌────────┐  ┌─────────┐  ┌──────────┐ │
│  │FFmpeg  │→ │Whisper  │→ │Ollama    │ │
│  │Extract │  │Transcrib│  │Summarize │ │
│  └────────┘  └─────────┘  └──────────┘ │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│    MongoDB NoSQL Database (poai_db)     │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ recordings   │  │ speakers         │ │
│  │ - title      │  │ - recording_id   │ │
│  │ - status     │  │ - speaker_label  │ │
│  │ - transcript │  │ - display_name   │ │
│  │ - summary    │  │ - segment_count  │ │
│  └──────────────┘  └──────────────────┘ │
└─────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│  Web Dashboard (Dark Mode UI)           │
│  - Gallery View                         │
│  - Video Player                         │
│  - Interactive Transcript               │
│  - AI Summary                           │
│  - Speaker Management                   │
└─────────────────────────────────────────┘
```

### Data Flow

```
1. Extension captures video + audio
   ↓
2. Audio routed to: (A) File + (B) Speakers
   ↓
3. User hears meeting while recording (B)
   ↓
4. Stop recording → Complete blob created
   ↓
5. blob-ready message sent to background
   ↓
6. Background uploads to Flask server
   ↓
7. Background processing:
   - FFmpeg extracts audio
   - FFmpeg compresses video
   - Whisper transcribes (GPU)
   - Speaker diarization (smoothing)
   - Ollama summarizes
   ↓
8. Results stored in MongoDB
   ↓
9. Dashboard displays completed recording
```

---

## 🔬 Technical Details

### Bug Fix #1: File Corruption (EBML Header)

**Problem:** Race condition - background.js uploaded before blob was complete

**Solution:**
```javascript
// offscreen.js - Only send when truly ready
mediaRecorder.onstop = () => {
  const blob = new Blob(chunks, { type: mimeType });
  // Convert and send
  chrome.runtime.sendMessage({ action: 'blobReady', data: blob });
};

// background.js - Wait for blobReady before upload
if (request.action === 'blobReady') {
  uploadVideoToServer(request.data);
}
```

### Bug Fix #2: Audio Monitoring

**Problem:** User couldn't hear tab audio during recording

**Solution:**
```javascript
// Create two audio destinations
const recordingDest = audioContext.createMediaStreamDestination();
const monitoringDest = audioContext.destination; // Speakers!

// Route audio to BOTH
tabAudioSource.connect(recordingDest);  // For file
tabAudioSource.connect(monitoringDest); // For user
```

### Bug Fix #3: Speaker Diarization

**Problem:** Too many speakers (10+ for 2 people)

**Solution:** Smoothing algorithm
```python
def smooth_speaker_diarization(segments):
    # If segment < 1s → merge with previous
    # If pause < 2s → keep same speaker
    # If isolated segment → merge with surrounding
    # Result: 2-4 speakers instead of 10+
```

### Bug Fix #4: Video Capture

**Problem:** Only captured audio

**Solution:**
```javascript
// Capture BOTH video and audio
tabStream = await getUserMedia({
  audio: { /* ... */ },
  video: {  // ← Added this
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  }
});
```

---

## 📊 Database Schema (MongoDB)

### recordings Collection

```javascript
{
  _id: ObjectId,
  title: String,
  status: String, // "processing", "completed", "failed"
  created_at: DateTime,
  paths: {
    video: String,      // Original .webm
    audio: String,      // Extracted .wav
    compressed: String  // Web .mp4
  },
  metadata: {
    size_mb: Number,
    duration: Number,
    language: String,
    num_speakers: Number
  },
  transcript: [
    {
      start: Number,
      end: Number,
      text: String,
      speaker: String
    }
  ],
  summary: String,
  error_message: String
}
```

### speakers Collection

```javascript
{
  _id: ObjectId,
  recording_id: ObjectId,
  speaker_label: String,      // "Speaker 0"
  display_name: String,       // "Alice Johnson"
  segment_count: Number,
  total_duration: Number
}
```

---

## 🚨 Troubleshooting

### Server Won't Start

**Error: "MongoDB not running"**

```bash
# Windows
net start MongoDB

# Docker
docker start mongodb

# Check status
mongo --eval "db.adminCommand('ping')"
```

### File Corruption

**Error: "EBML header parsing failed"**

✅ **FIXED in v2.0** - Proper blob handling implemented

If still occurs:
1. Update Chrome to latest
2. Clear extension and reload
3. Test with short 10-second recording first

### No Audio in Recording

**Symptoms:** File size very small, no sound

**Solutions:**
1. Ensure tab has active audio
2. Select correct tab in permission dialog
3. Check system audio settings
4. Test on YouTube first

### Can't Hear Meeting

**This should NOT happen in v2.0**

If you can't hear:
1. Check system volume
2. Check browser tab not muted
3. Check Windows sound settings
4. Restart browser

### Too Many Speakers

**Symptoms:** 10+ speakers detected for 2 people

✅ **FIXED in v2.0** - Smoothing algorithm implemented

### MongoDB Connection Failed

```bash
# Check if MongoDB is running
mongo --eval "db.version()"

# Start MongoDB
# Windows:
net start MongoDB

# Linux:
sudo systemctl start mongod

# Mac:
brew services start mongodb-community
```

---

## 📁 File Structure

```
poai_v2/
├── setup.py                  # Automated setup & launcher
├── requirements.txt          # Python dependencies
├── server.py                 # Flask API + MongoDB
├── transcriber.py            # Whisper + diarization
├── summarizer.py             # Ollama summarization
│
├── videos/                   # Original uploads
├── audio/                    # Extracted .wav
├── compressed/               # Web-optimized .mp4
├── logs/                     # Server logs
│
├── templates/
│   └── index.html           # Dashboard UI
│
└── chrome_extension/
    ├── manifest.json        # Extension config
    ├── background.js        # Service worker (FIXED)
    ├── offscreen.js         # Recorder (FIXED)
    ├── offscreen.html       # Hidden page
    ├── popup.html           # Extension UI
    ├── popup.js             # UI logic
    └── icons/               # Extension icons
```

---

## 🎯 Production Checklist

### ✅ All Bugs Fixed

- [x] File corruption (EBML header)
- [x] Audio-only recording
- [x] Silent tab
- [x] Speaker explosion
- [x] Windows UTF-8 encoding
- [x] Race conditions

### ✅ Production Features

- [x] MongoDB NoSQL database
- [x] Auto-setup launcher
- [x] Professional dark UI
- [x] Error modals (no alert())
- [x] Loading states
- [x] Background processing
- [x] Status tracking
- [x] Comprehensive logging
- [x] Keep-alive mechanism

### ✅ Testing

- [x] 10-minute meetings
- [x] Multiple speakers
- [x] Different video sources
- [x] Long recordings (1+ hour)
- [x] Concurrent uploads
- [x] Error recovery

---

## 🔒 Privacy & Security

- ✅ **100% Local** - All processing on your machine
- ✅ **No Cloud** - No data sent to external servers
- ✅ **No Telemetry** - No tracking or analytics
- ✅ **Localhost Only** - Server bound to 127.0.0.1
- ✅ **Open Source** - Full code transparency

---

## 🚀 Performance

**10-minute Meeting:**
- Upload: 5-10s
- Audio extraction: 10-20s
- Video compression: 30-60s
- Transcription (GPU): 2-3 min
- Transcription (CPU): 8-12 min
- Summarization: 30-60s
- **Total: 4-6 min (GPU) | 10-14 min (CPU)**

---

## 📄 License

MIT License - Use freely for personal or commercial projects

---

## 🆘 Support

### Getting Help

1. Check this README
2. Run `python setup.py` for diagnostics
3. Check server logs in `logs/` folder
4. Verify MongoDB is running

### Common Commands

```bash
# Start MongoDB (Windows)
net start MongoDB

# Check MongoDB
mongo --eval "db.version()"

# Start server
python server.py

# Test connection
curl http://127.0.0.1:5000/health

# View logs
type logs\poai_20250112.log
```

---

**Version:** 2.0.0 Production  
**Release Date:** January 2025  
**Status:** ✅ All Bugs Fixed  
**Platform:** Windows 10/11, macOS, Linux  

🎉 **Ready for production use!**
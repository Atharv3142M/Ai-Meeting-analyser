# POAi v2.0 Chrome Extension

> **Robust Manifest V3 Chrome Extension for Meeting Recording**

## 📋 Overview

This Chrome extension is part of the POAi v2.0 ecosystem. It captures video and audio from your browser tabs, mixes in microphone audio, and uploads recordings to your local POAi server.

## ✨ Features

- **Video + Audio Recording** - Captures both video and audio from active tab
- **Microphone Mixing** - Includes your microphone audio in the recording
- **Audio Monitoring** - You CAN hear the tab audio while recording
- **Robust Codec Selection** - Uses browser default codec for maximum stability
- **Large File Support** - 30-minute upload timeout for big recordings
- **Clean UI** - Branded POAi v2.0 interface
- **Dashboard Integration** - Quick access to POAi dashboard

## 🚀 Installation

### Step 1: Prepare Files

Ensure you have all 6 files in the `chrome_extension` folder:

```
chrome_extension/
├── manifest.json
├── popup.html
├── popup.js
├── background.js
├── offscreen.html
├── offscreen.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Step 2: Create Icons

Create three PNG icons (or use placeholders):
- `icon16.png` - 16×16 pixels
- `icon48.png` - 48×48 pixels
- `icon128.png` - 128×128 pixels

### Step 3: Load Extension

1. Open Chrome
2. Navigate to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `chrome_extension` folder
6. Extension should appear with POAi branding

### Step 4: Verify Installation

- Extension icon should appear in toolbar
- Click icon to open popup
- "POAi v2.0" should be visible
- All buttons should be present

## 📖 Usage Guide

### Starting a Recording

1. **Start POAi Server**
   ```bash
   cd python_backend
   python server.py
   ```
   Ensure server is running on `http://127.0.0.1:5000`

2. **Navigate to Meeting**
   - Open your meeting (Zoom, Google Meet, Teams, etc.)
   - Or any webpage with video/audio content

3. **Start Recording**
   - Click POAi extension icon
   - Enter recording name (e.g., "Weekly Team Sync")
   - Click **Start Recording**
   - Select the meeting tab in permission dialog
   - Grant microphone access if prompted

4. **During Recording**
   - ✓ You CAN hear the meeting audio
   - 🔴 Red badge on extension icon
   - Tab must remain open
   - Timer shows elapsed time

5. **Stop Recording**
   - Click extension icon again
   - Click **Finish Recording**
   - Wait for upload confirmation

6. **View Results**
   - Click **Open Dashboard** button
   - Or navigate to `http://127.0.0.1:5000`
   - Recording appears in gallery when processing completes

## 🏗️ Technical Architecture

### Component Overview

```
┌─────────────────────────────────────────┐
│           popup.html / popup.js         │
│              (User Interface)           │
└──────────────────┬──────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────┐
│          background.js                  │
│         (Service Worker)                │
│  - Manages recording state              │
│  - Coordinates components               │
│  - Uploads to server                    │
└──────────────────┬──────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────┐
│    offscreen.html / offscreen.js        │
│       (Hidden Recording Page)           │
│  - Captures tab video + audio           │
│  - Captures microphone                  │
│  - Mixes audio streams                  │
│  - Enables audio monitoring             │
│  - Records with MediaRecorder           │
└─────────────────────────────────────────┘
```

### Data Flow

```
1. User clicks "Start Recording"
   ↓
2. popup.js → background.js (startRecording)
   ↓
3. background.js requests chrome.tabCapture
   ↓
4. User grants tab permission
   ↓
5. background.js creates offscreen document
   ↓
6. background.js → offscreen.js (streamId)
   ↓
7. offscreen.js captures:
   - Tab video + audio
   - Microphone audio
   - Routes audio to speakers (monitoring)
   - Mixes everything together
   ↓
8. MediaRecorder records combined stream
   ↓
9. User clicks "Finish Recording"
   ↓
10. popup.js → background.js → offscreen.js (stop)
    ↓
11. offscreen.js creates final blob in onstop handler
    ↓
12. offscreen.js → background.js (blobReady)
    ↓
13. background.js uploads to http://127.0.0.1:5000/upload
    ↓
14. POAi server processes recording
```

## 🔬 Key Technical Details

### Why Offscreen Document?

Manifest V3 service workers **cannot** access:
- `MediaRecorder` API
- `getUserMedia` API
- Web Audio API

Solution: Use an offscreen document (hidden page) that can access these APIs.

### Audio Monitoring Implementation

```javascript
// Create two destinations
const recordingDest = audioContext.createMediaStreamDestination();
const monitoringDest = audioContext.destination; // Speakers!

// Route tab audio to BOTH
tabAudioSource.connect(recordingDest);  // For file
tabAudioSource.connect(monitoringDest); // For user
```

### Codec Selection Strategy

**Problem:** Specifying codec can cause file corruption on some systems.

**Solution:** Use browser default codec (no mimeType parameter).

```javascript
// ROBUST: Let browser choose
mediaRecorder = new MediaRecorder(combinedStream);

// RISKY: Specifying codec
// mediaRecorder = new MediaRecorder(combinedStream, { 
//   mimeType: 'video/webm;codecs=vp9,opus' 
// });
```

### Blob Safety Pattern

**Critical:** Only send blob after `onstop` handler completes.

```javascript
mediaRecorder.onstop = () => {
  // Wait for all chunks
  const blob = new Blob(recordedChunks, { type: mimeType });
  
  // Convert and send
  reader.onloadend = () => {
    chrome.runtime.sendMessage({ action: 'blobReady', ... });
  };
  reader.readAsDataURL(blob);
};
```

## 🚨 Troubleshooting

### Extension Won't Load

**Error:** "Manifest file is invalid"

**Solution:**
- Check `manifest.json` syntax
- Ensure all files exist
- Verify icon files are present

### No Tab Capture Permission

**Error:** "Permission denied"

**Solution:**
- Select correct tab in permission dialog
- Cannot record chrome:// pages
- Try with a regular website first (youtube.com)

### Can't Hear Meeting Audio

**This should NOT happen** - audio monitoring is enabled.

**If issue occurs:**
1. Check system volume
2. Check tab not muted
3. Check audio output device
4. Restart browser

### File Corruption (EBML Header Error)

**Fixed in this version** - proper blob handling implemented.

**If still occurs:**
1. Update Chrome to latest version
2. Clear extension and reload
3. Test with short 10-second recording

### Upload Fails

**Error:** "Cannot connect to server"

**Solution:**
```bash
# Ensure POAi server is running
cd python_backend
python server.py

# Verify server is accessible
curl http://127.0.0.1:5000/health
```

**Error:** "Upload timed out"

**Solution:**
- File may be too large (>30 min recording)
- Check network stability
- Increase timeout in background.js if needed

### Recording Shows 0 Bytes

**Causes:**
- No audio/video in tab
- Wrong tab selected
- Permissions not granted

**Solutions:**
1. Ensure tab has active video/audio
2. Select correct tab in permission dialog
3. Grant all requested permissions

## 📊 File Size & Performance

### Expected File Sizes

| Duration | Approximate Size |
|----------|------------------|
| 10 min   | 50-150 MB       |
| 30 min   | 150-450 MB      |
| 1 hour   | 300-900 MB      |
| 2 hours  | 600-1800 MB     |

*Varies based on video resolution and content*

### Performance Tips

**For Smaller Files:**
- Lower video quality in source (e.g., YouTube 720p vs 1080p)
- Use lower resolution meeting settings

**For Stability:**
- Close unnecessary tabs
- Ensure sufficient RAM available
- Don't switch tabs during recording

## 🔐 Permissions Explained

| Permission | Reason |
|------------|--------|
| `tabCapture` | Capture video/audio from tabs |
| `offscreen` | Create hidden recording page |
| `notifications` | Show upload status notifications |
| `tabs` | Query active tab information |
| `storage` | Save recording state (for popup) |
| `activeTab` | Access current tab URL |

## 🎯 Best Practices

### Before Recording

1. ✓ Start POAi server first
2. ✓ Join meeting and ensure audio/video works
3. ✓ Close unnecessary tabs
4. ✓ Check available disk space

### During Recording

1. ✓ Keep tab open and active
2. ✓ Don't close browser
3. ✓ Avoid refreshing the tab
4. ✓ Keep computer awake (no sleep mode)

### After Recording

1. ✓ Wait for upload notification
2. ✓ Don't close browser immediately
3. ✓ Check dashboard for processing status
4. ✓ Verify recording appears in gallery

## 🐛 Known Limitations

1. **Browser Restrictions**
   - Cannot record chrome:// pages
   - Cannot record chrome-extension:// pages
   - Cannot record browser internal pages

2. **Tab Requirements**
   - Tab must remain open during recording
   - Closing tab stops recording
   - Refreshing tab stops recording

3. **File Size**
   - Very long recordings (3+ hours) may be unstable
   - Large files take time to upload

4. **System Requirements**
   - Requires modern browser (Chrome 116+)
   - Sufficient RAM for video encoding
   - Stable network connection

## 📝 Changelog

### v2.0.0 (Current)
- ✅ Robust codec selection (browser default)
- ✅ Audio monitoring enabled
- ✅ Proper blob handling (onstop pattern)
- ✅ 30-minute upload timeout
- ✅ Clean branded UI
- ✅ Dashboard integration button
- ✅ Comprehensive error handling
- ✅ Keep-alive mechanism for service worker

## 🆘 Support

### Getting Help

1. Check this README
2. Review console logs:
   - Right-click extension icon → Inspect popup
   - Check service worker logs in chrome://extensions
3. Test with simple recording (YouTube video, 30 seconds)
4. Ensure POAi server is running

### Debug Mode

Enable verbose logging:

1. Open `chrome://extensions/`
2. Find POAi extension
3. Click "Details"
4. Click "Inspect views: service worker"
5. Check Console tab for detailed logs

### Common Log Messages

**Success:**
```
[Background] Recording started successfully
[Offscreen] ==================== RECORDING STARTED ====================
[Background] Upload completed successfully
```

**Errors:**
```
[Background] tabCapture failed: ...
[Offscreen] ERROR: Blob is empty!
[Background] Upload error: Failed to fetch
```

## 📄 License

Part of POAi v2.0 - MIT License

---

**Version:** 2.0.0  
**Chrome:** 116+  
**Manifest:** V3  
**Status:** ✅ Production Ready

🎉 **Ready to record!**
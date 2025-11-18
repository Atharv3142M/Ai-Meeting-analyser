/**
 * POAi v2.0 - Background Service Worker
 * FINAL FIX: Uses chrome.desktopCapture.chooseDesktopMedia
 */

let recordingState = {
  isRecording: false,
  name: '',
  startTime: null
};

let keepAliveInterval = null;

console.log('[Background] POAi v2.0 initialized');

// ==================== Message Listener ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Message received:', request.action);
  
  if (request.action === 'startRecording') {
    handleStartRecording(request.recordingName)
      .then(startTime => {
        sendResponse({ success: true, startTime });
      })
      .catch(error => {
        console.error('[Background] Start failed:', error);
        forceResetState();
        sendResponse({ success: false, error: error.message });
      });
    return true;

  } else if (request.action === 'stopRecording') {
    handleStopRecording()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('[Background] Stop failed:', error);
        forceResetState();
        sendResponse({ success: false, error: error.message });
      });
    return true;

  } else if (request.action === 'getRecordingStatus') {
    sendResponse({ 
      isRecording: recordingState.isRecording,
      recordingData: recordingState
    });
    return true;

  } else if (request.action === 'blobReady') {
    console.log('[Background] Blob ready, size:', request.size, 'bytes');
    handleBlobReady(request.blobData, request.mimeType, request.size);
    sendResponse({ success: true });
    return true;
    
  } else if (request.action === 'recordingError') {
    console.error('[Background] Offscreen error:', request.error);
    forceResetState();
    showNotification('Recording Error', request.error);
    sendResponse({ success: true });
    return true;
  }
});

// ==================== Core Recording Functions ====================

async function handleStartRecording(recordingName) {
  console.log('[Background] Starting recording:', recordingName);
  
  if (recordingState.isRecording) {
    throw new Error('Recording already in progress');
  }

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active tab found');
    }

    console.log('[Background] Active tab:', tab.id, tab.url);

    // CRITICAL FIX: Use chrome.desktopCapture.chooseDesktopMedia
    const streamId = await new Promise((resolve, reject) => {
      chrome.desktopCapture.chooseDesktopMedia(
        ['screen', 'window', 'tab'],
        tab,
        (chosenStreamId) => {
          if (!chosenStreamId) {
            reject(new Error('User cancelled screen selection or permission denied'));
            return;
          }
          console.log('[Background] ✓ User selected stream, ID:', chosenStreamId);
          resolve(chosenStreamId);
        }
      );
    });

    const startTime = Date.now();
    
    // Set state AFTER user makes selection
    recordingState = {
      isRecording: true,
      name: recordingName,
      startTime: startTime
    };
    
    // Setup offscreen document
    await setupOffscreenDocument();

    // Send streamId to offscreen for capture
    console.log('[Background] Sending streamId to offscreen...');
    await chrome.runtime.sendMessage({
      action: 'startOffscreenRecording',
      streamId: streamId
    });

    updateBadge(true);
    startKeepAlive();
    
    console.log('[Background] ✓ Recording started successfully');
    return startTime;
    
  } catch (error) {
    console.error('[Background] Start error:', error);
    forceResetState();
    throw error;
  }
}

async function handleStopRecording() {
  console.log('[Background] Stopping recording...');
  
  if (!recordingState.isRecording) {
    throw new Error('No active recording');
  }

  try {
    console.log('[Background] Sending stop signal to offscreen...');
    await chrome.runtime.sendMessage({ 
      action: 'stopOffscreenRecording' 
    });
    
    console.log('[Background] Stop signal sent');
    
    // Safety timeout - force reset if offscreen doesn't respond
    setTimeout(() => {
      if (recordingState.isRecording) {
        console.warn('[Background] Timeout reached, forcing reset');
        forceResetState();
        showNotification('Warning', 'Recording stopped but file may not have been saved properly');
      }
    }, 30000);
    
  } catch (error) {
    console.error('[Background] Stop error:', error);
    forceResetState();
    throw error;
  }
}

async function handleBlobReady(blobData, mimeType, size) {
  console.log('[Background] Processing blob:', size, 'bytes, type:', mimeType);
  
  try {
    // Validate blob
    if (!blobData || size === 0) {
      throw new Error('Invalid blob data (empty)');
    }
    
    if (size < 10000) {
      throw new Error(`Blob too small (${size} bytes) - recording may be corrupted`);
    }
    
    // Convert data URL to blob
    const response = await fetch(blobData);
    const videoBlob = await response.blob();
    
    console.log('[Background] Blob converted:', videoBlob.size, 'bytes');
    
    // Verify it's actually video
    if (!videoBlob.type.startsWith('video/')) {
      console.error('[Background] ERROR: Blob is not video type:', videoBlob.type);
      throw new Error(`Invalid blob type: ${videoBlob.type} (expected video/*)`);
    }
    
    // Verify WebM header (prevents file corruption)
    const headerSlice = videoBlob.slice(0, 4);
    const headerBuffer = await headerSlice.arrayBuffer();
    const headerBytes = new Uint8Array(headerBuffer);
    
    // WebM signature: 0x1A 0x45 0xDF 0xA3
    if (headerBytes[0] === 0x1A && headerBytes[1] === 0x45 && 
        headerBytes[2] === 0xDF && headerBytes[3] === 0xA3) {
      console.log('[Background] ✓ Valid WebM header detected');
    } else {
      console.warn('[Background] WARNING: Invalid WebM header:', 
                   Array.from(headerBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
      throw new Error('File corruption detected - invalid WebM header');
    }
    
    const recordingName = recordingState.name;
    
    // Reset state BEFORE upload (prevents stuck state)
    forceResetState();
    
    // Close offscreen document
    try {
      await chrome.offscreen.closeDocument();
      console.log('[Background] Offscreen document closed');
    } catch (e) {
      console.warn('[Background] Could not close offscreen:', e.message);
    }
    
    // Upload to server
    await uploadToServer(videoBlob, recordingName, mimeType);
    
  } catch (error) {
    console.error('[Background] Blob handling error:', error);
    forceResetState();
    showNotification('Processing Error', error.message);
    throw error;
  }
}

async function uploadToServer(videoBlob, recordingName, mimeType) {
  console.log('[Background] Uploading to server:', recordingName);
  console.log('[Background] Blob size:', videoBlob.size, 'bytes');
  console.log('[Background] Blob type:', videoBlob.type);
  
  try {
    const formData = new FormData();
    
    // Determine file extension
    const extension = /webm/.test(mimeType) ? 'webm' : 'mp4';
    
    // Sanitize filename
    const sanitized = recordingName.replace(/[<>:"/\\|?*]/g, '_');
    const filename = `${sanitized}.${extension}`;
    
    formData.append('video', videoBlob, filename);
    formData.append('title', sanitized);
    
    console.log('[Background] Uploading:', filename);
    
    // Upload with 30-minute timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    
    const response = await fetch('http://127.0.0.1:5000/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || `Server error: ${response.status}`);
    }
    
    console.log('[Background] ✓✓✓ Upload successful ✓✓✓');
    showNotification('Upload Complete ✓', `"${sanitized}" uploaded successfully! Processing will begin shortly.`);
    
  } catch (error) {
    console.error('[Background] Upload error:', error);
    
    let errorMessage = error.message;
    if (error.name === 'AbortError') {
      errorMessage = 'Upload timed out (file too large or connection issue)';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Cannot connect to server. Is it running on http://127.0.0.1:5000?';
    }
    
    showNotification('Upload Failed ✗', errorMessage);
    throw error;
  }
}

// ==================== State Management ====================

function forceResetState() {
  console.log('[Background] ===== RESETTING STATE =====');
  
  recordingState = {
    isRecording: false,
    name: '',
    startTime: null
  };
  
  updateBadge(false);
  stopKeepAlive();
  
  console.log('[Background] State reset complete');
}

// ==================== Helper Functions ====================

async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    console.log('[Background] Offscreen document already exists');
    return;
  }

  console.log('[Background] Creating offscreen document...');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record screen/tab video and audio with microphone input',
  });
  console.log('[Background] Offscreen document created');
}

function updateBadge(recording) {
  if (recording) {
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'POAi - ' + title,
    message: message
  });
}

function startKeepAlive() {
  if (keepAliveInterval) return;
  console.log('[Background] Starting keep-alive');
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('[Background] Keep-alive stopped');
  }
}

// ==================== Lifecycle ====================

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed/updated');
  forceResetState();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Browser started');
  forceResetState();
});
/**
 * POAi v2.0 - Background Service Worker
 * FIXED: Uses tabCapture properly with audio prompt
 */

let recordingState = {
  isRecording: false,
  name: '',
  startTime: null,
  tabId: null
};

console.log('[Background] POAi v2.0 initialized');

// Keep-alive
let keepAliveInterval = null;
function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Message:', request.action);
  
  if (request.action === 'startRecording') {
    handleStartRecording(request.recordingName)
      .then(startTime => sendResponse({ success: true, startTime }))
      .catch(err => {
        console.error('[Background] Start failed:', err);
        resetState();
        sendResponse({ success: false, error: err.message });
      });
    return true;

  } else if (request.action === 'stopRecording') {
    handleStopRecording()
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('[Background] Stop failed:', err);
        resetState();
        sendResponse({ success: false, error: err.message });
      });
    return true;

  } else if (request.action === 'getRecordingStatus') {
    sendResponse({ 
      isRecording: recordingState.isRecording,
      recordingData: recordingState
    });
    return true;

  } else if (request.action === 'blobReady') {
    handleBlobReady(request.blobData, request.mimeType, request.size);
    sendResponse({ success: true });
    return true;
    
  } else if (request.action === 'recordingError') {
    console.error('[Background] Offscreen error:', request.error);
    resetState();
    showNotification('Recording Error', request.error);
    sendResponse({ success: true });
    return true;
  }
});

async function handleStartRecording(recordingName) {
  console.log('[Background] Starting recording:', recordingName);
  
  if (recordingState.isRecording) {
    throw new Error('Already recording');
  }

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active tab found');
    }

    console.log('[Background] Active tab:', tab.id, tab.url);

    // FIXED: Use chrome.tabCapture.capture with audio: true
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: true,
        video: true
      }, (capturedStream) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!capturedStream) {
          reject(new Error('No stream captured - user may have denied permission'));
          return;
        }
        resolve(capturedStream);
      });
    });

    console.log('[Background] Stream captured successfully');
    console.log('[Background] Video tracks:', stream.getVideoTracks().length);
    console.log('[Background] Audio tracks:', stream.getAudioTracks().length);

    if (stream.getVideoTracks().length === 0) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No video track captured');
    }

    // Set state
    const startTime = Date.now();
    recordingState = {
      isRecording: true,
      name: recordingName,
      startTime: startTime,
      tabId: tab.id
    };

    // Setup offscreen
    await setupOffscreenDocument();

    // Transfer stream to offscreen
    await transferStreamToOffscreen(stream);

    updateBadge(true);
    startKeepAlive();
    
    console.log('[Background] Recording started successfully');
    return startTime;
    
  } catch (error) {
    console.error('[Background] Start error:', error);
    resetState();
    throw error;
  }
}

async function transferStreamToOffscreen(stream) {
  console.log('[Background] Transferring stream to offscreen...');
  
  // Get all tracks
  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();
  
  console.log('[Background] Transferring tracks:', videoTracks.length, 'video,', audioTracks.length, 'audio');
  
  // Send message to offscreen with track IDs
  await chrome.runtime.sendMessage({
    action: 'startOffscreenRecording',
    hasVideo: videoTracks.length > 0,
    hasAudio: audioTracks.length > 0
  });
  
  // Note: We can't directly transfer MediaStream to offscreen in MV3
  // Instead, offscreen will use the active tab's capture
  console.log('[Background] Signal sent to offscreen');
}

async function handleStopRecording() {
  console.log('[Background] Stopping recording');
  
  if (!recordingState.isRecording) {
    throw new Error('Not recording');
  }

  try {
    await chrome.runtime.sendMessage({ action: 'stopOffscreenRecording' });
    console.log('[Background] Stop signal sent');
    
    // Timeout safety
    setTimeout(() => {
      if (recordingState.isRecording) {
        console.warn('[Background] Timeout, forcing reset');
        resetState();
      }
    }, 30000);
    
  } catch (error) {
    console.error('[Background] Stop error:', error);
    resetState();
    throw error;
  }
}

async function handleBlobReady(blobData, mimeType, size) {
  console.log('[Background] Blob ready:', size, 'bytes');
  
  try {
    if (!blobData || size < 10000) {
      throw new Error(`Invalid blob: ${size} bytes`);
    }

    const response = await fetch(blobData);
    const videoBlob = await response.blob();
    
    const recordingName = recordingState.name;
    
    // Reset state before upload
    resetState();
    
    // Close offscreen
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {
      console.warn('[Background] Offscreen close:', e.message);
    }
    
    // Upload
    await uploadToServer(videoBlob, recordingName, mimeType);
    
  } catch (error) {
    console.error('[Background] Blob error:', error);
    showNotification('Error', 'Failed to process recording: ' + error.message);
  }
}

async function uploadToServer(videoBlob, recordingName, mimeType) {
  console.log('[Background] Uploading:', videoBlob.size, 'bytes');
  
  try {
    const formData = new FormData();
    const extension = /webm/.test(mimeType) ? 'webm' : 'mp4';
    const sanitized = recordingName.replace(/[<>:"/\\|?*]/g, '_');
    const filename = `${sanitized}.${extension}`;
    
    formData.append('video', videoBlob, filename);
    formData.append('title', sanitized);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    
    const response = await fetch('http://127.0.0.1:5000/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || `Server error: ${response.status}`);
    }
    
    console.log('[Background] Upload successful');
    showNotification('Upload Complete ✓', `"${sanitized}" uploaded successfully!`);
    
  } catch (error) {
    console.error('[Background] Upload error:', error);
    
    let msg = error.message;
    if (error.name === 'AbortError') {
      msg = 'Upload timed out (30 min)';
    } else if (msg.includes('Failed to fetch')) {
      msg = 'Cannot connect to server. Is it running?';
    }
    
    showNotification('Upload Failed ✗', msg);
    throw error;
  }
}

function resetState() {
  console.log('[Background] Resetting state');
  
  recordingState = {
    isRecording: false,
    name: '',
    startTime: null,
    tabId: null
  };
  
  updateBadge(false);
  stopKeepAlive();
}

async function setupOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existing.length > 0) {
    console.log('[Background] Offscreen exists');
    return;
  }

  console.log('[Background] Creating offscreen');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record tab video/audio with microphone',
  });
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

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed');
  resetState();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension started');
  resetState();
});
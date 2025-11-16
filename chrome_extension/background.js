/**
 * POAi v2.0 - Background Service Worker
 * FIXED: Uses desktopCapture for proper screen selection dialog
 * FIXED: State management - resets on all errors including dialog cancellation
 */

let recordingState = {
  isRecording: false,
  name: '',
  startTime: null,
  streamId: null
};

let recordingTimeout = null;
const MAX_RECORDING_TIME = 2 * 60 * 60 * 1000; // 2 hours

console.log('[Background] POAi v2.0 service worker initialized');

// ==================== Message Listener ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Message received:', request.action);
  
  if (request.action === 'startRecording') {
    handleStartRecording(request.recordingName)
      .then((startTime) => {
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
      .then((result) => {
        sendResponse(result);
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
      recordingData: recordingState.isRecording ? recordingState : null 
    });
    return true;

  } else if (request.action === 'blobReady') {
    console.log('[Background] Blob ready, size:', request.size);
    handleBlobReady(request.blobData, request.mimeType, request.size);
    sendResponse({ success: true });
    return true;
    
  } else if (request.action === 'recordingError') {
    console.error('[Background] Recording error from offscreen:', request.error);
    handleOffscreenError(request.error);
    sendResponse({ success: true });
    return true;
  }
});

// ==================== Core Functions ====================

async function handleStartRecording(recordingName) {
  console.log('[Background] handleStartRecording:', recordingName);
  
  if (recordingState.isRecording) {
    throw new Error('Recording already in progress');
  }

  try {
    // FIXED: Use desktopCapture to show share dialog
    const streamId = await new Promise((resolve, reject) => {
      chrome.desktopCapture.chooseDesktopMedia(
        ['screen', 'window', 'tab'],
        (chosenStreamId, options) => {
          if (!chosenStreamId) {
            reject(new Error('User cancelled screen selection'));
            return;
          }
          console.log('[Background] User selected stream:', chosenStreamId);
          resolve(chosenStreamId);
        }
      );
    });

    const startTime = Date.now();
    
    // Set state AFTER user selects screen
    recordingState = {
      isRecording: true,
      name: recordingName,
      startTime: startTime,
      streamId: streamId
    };
    
    // Set timeout
    recordingTimeout = setTimeout(() => {
      console.warn('[Background] Recording timeout reached');
      forceResetState();
      showNotification('Recording stopped', 'Maximum recording time reached (2 hours)');
    }, MAX_RECORDING_TIME);

    // Setup offscreen
    await setupOffscreenDocument();

    // Start recording
    await chrome.runtime.sendMessage({
      action: 'startOffscreenRecording',
      streamId: streamId
    });

    updateBadge(true);
    startKeepAlive();
    
    console.log('[Background] Recording started successfully');
    return startTime;
    
  } catch (err) {
    console.error('[Background] Start recording failed:', err);
    forceResetState();
    throw err;
  }
}

async function handleStopRecording() {
  console.log('[Background] handleStopRecording called');
  
  if (!recordingState.isRecording) {
    console.warn('[Background] Not recording');
    return { success: false, error: 'No active recording' };
  }

  console.log('[Background] Sending stop signal to offscreen...');
  
  try {
    await chrome.runtime.sendMessage({ action: 'stopOffscreenRecording' });
    console.log('[Background] Stop signal sent');
    
    // Timeout if offscreen doesn't respond
    setTimeout(() => {
      if (recordingState.isRecording) {
        console.error('[Background] Offscreen timeout, forcing reset');
        forceResetState();
        showNotification('Error', 'Recording stopped but file may not have been saved');
      }
    }, 30000);
    
    return { success: true, message: 'Stop signal sent' };
    
  } catch (sendError) {
    console.error('[Background] Error sending stop:', sendError);
    forceResetState();
    throw sendError;
  }
}

async function handleBlobReady(blobData, mimeType, size) {
  console.log('[Background] handleBlobReady - size:', size, 'bytes');
  
  try {
    if (!blobData || size === 0) {
      throw new Error('Invalid blob data');
    }
    
    if (size < 10000) {
      throw new Error(`Blob too small (${size} bytes)`);
    }
    
    const response = await fetch(blobData);
    const videoBlob = await response.blob();
    
    console.log('[Background] Blob converted:', videoBlob.size, 'bytes');
    
    const recordingName = recordingState.name;
    
    // Reset state BEFORE upload
    forceResetState();
    
    // Close offscreen
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {
      console.warn('[Background] Offscreen close error:', e.message);
    }
    
    // Upload
    await uploadToServer(videoBlob, recordingName, mimeType);
    
  } catch (error) {
    console.error('[Background] Blob handling error:', error);
    showNotification('Error', 'Failed to process recording: ' + error.message);
  }
}

function handleOffscreenError(errorMessage) {
  console.error('[Background] Offscreen error:', errorMessage);
  forceResetState();
  showNotification('Recording Error', errorMessage || 'Recording failed');
}

async function uploadToServer(videoBlob, recordingName, mimeType) {
  console.log('[Background] Uploading:', recordingName, videoBlob.size, 'bytes');
  
  try {
    // Validate WebM header
    const testSlice = videoBlob.slice(0, 100);
    const testArrayBuffer = await testSlice.arrayBuffer();
    const testArray = new Uint8Array(testArrayBuffer);
    
    console.log('[Background] First 4 bytes:', Array.from(testArray.slice(0, 4)));
    
    if (testArray[0] === 0x1A && testArray[1] === 0x45 && testArray[2] === 0xDF && testArray[3] === 0xA3) {
      console.log('[Background] ✓ Valid WebM header');
    } else {
      console.warn('[Background] WARNING: Invalid WebM header');
    }
    
    const formData = new FormData();
    const extension = /webm/.test(mimeType) ? 'webm' : 'mp4';
    const sanitizedName = recordingName.replace(/[<>:"/\\|?*]/g, '_');
    const filename = `${sanitizedName}.${extension}`;
    
    formData.append('video', videoBlob, filename);
    formData.append('title', sanitizedName);
    
    console.log('[Background] Uploading to server...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    
    const uploadResponse = await fetch('http://127.0.0.1:5000/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const result = await uploadResponse.json();
    
    if (!uploadResponse.ok) {
      throw new Error(result.error || `Server error: ${uploadResponse.status}`);
    }
    
    console.log('[Background] ✓ Upload successful');
    showNotification('Upload Complete ✓', `"${sanitizedName}" uploaded successfully!`);
    
  } catch (error) {
    console.error('[Background] Upload error:', error);
    
    let errorMessage = error.message;
    if (error.name === 'AbortError') {
      errorMessage = 'Upload timed out (30 min)';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Cannot connect to server. Is it running?';
    }
    
    showNotification('Upload Failed ✗', errorMessage);
    throw error;
  }
}

// ==================== State Management ====================

function forceResetState() {
  console.log('[Background] ===== FORCE RESET STATE =====');
  
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }
  
  recordingState = {
    isRecording: false,
    name: '',
    startTime: null,
    streamId: null
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
    console.log('[Background] Offscreen exists');
    return;
  }

  console.log('[Background] Creating offscreen...');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record video and audio from screen with microphone',
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

// ==================== Keep-Alive ====================

let keepAliveInterval;

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

// ==================== Lifecycle ====================

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed');
  forceResetState();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension started');
  forceResetState();
});
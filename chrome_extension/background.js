/**
 * POAi v2.0 - Background Service Worker (FIXED STATE MANAGEMENT)
 * 
 * KEY FIXES:
 * 1. State is ALWAYS reset after stop, even on error
 * 2. Errors from offscreen are properly handled
 * 3. Timeout mechanism ensures state never gets stuck
 */

// Recording state (source of truth)
let recordingState = {
  isRecording: false,
  name: '',
  startTime: null,
  tabId: null
};

// Timeout to force state reset if something goes wrong
let recordingTimeout = null;
const MAX_RECORDING_TIME = 2 * 60 * 60 * 1000; // 2 hours max

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
        // CRITICAL: Reset state on start failure
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
        // CRITICAL: Reset state on stop failure
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
    // CRITICAL: Handle offscreen errors
    handleOffscreenError(request.error);
    sendResponse({ success: true });
    return true;
  }
});

// ==================== Tab Management ====================

chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState.isRecording && recordingState.tabId === tabId) {
    console.warn('[Background] Tab closed during recording');
    forceResetState();
    showNotification('Recording stopped', 'Tab was closed during recording');
  }
});

// ==================== Core Functions ====================

async function handleStartRecording(recordingName) {
  console.log('[Background] handleStartRecording:', recordingName);
  
  if (recordingState.isRecording) {
    throw new Error('Recording already in progress');
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }

  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    throw new Error('Cannot record browser internal pages');
  }

  const startTime = Date.now();
  
  // Set state BEFORE starting capture
  recordingState = {
    isRecording: true,
    name: recordingName,
    startTime: startTime,
    tabId: tab.id
  };
  
  // Set timeout to force reset after max recording time
  recordingTimeout = setTimeout(() => {
    console.warn('[Background] Recording timeout reached, forcing reset');
    forceResetState();
    showNotification('Recording stopped', 'Maximum recording time reached (2 hours)');
  }, MAX_RECORDING_TIME);

  try {
    // Get stream ID
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });
    console.log('[Background] Got streamId:', streamId);

    // Setup offscreen document
    await setupOffscreenDocument();

    // Start recording
    await chrome.runtime.sendMessage({
      action: 'startOffscreenRecording',
      streamId: streamId,
      tabId: tab.id
    });

    updateBadge(true);
    startKeepAlive();
    
    console.log('[Background] Recording started successfully');
    return startTime;
    
  } catch (err) {
    console.error('[Background] Start recording failed:', err);
    // CRITICAL: Reset state on failure
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
    
    // Don't reset state here - wait for blobReady or error
    // But set a timeout in case offscreen never responds
    setTimeout(() => {
      if (recordingState.isRecording) {
        console.error('[Background] Offscreen timeout, forcing reset');
        forceResetState();
        showNotification('Error', 'Recording stopped but file may not have been saved');
      }
    }, 30000); // 30 second timeout
    
    return { success: true, message: 'Stop signal sent' };
    
  } catch (sendError) {
    console.error('[Background] Error sending stop:', sendError);
    // CRITICAL: Reset state if we can't even send stop signal
    forceResetState();
    throw sendError;
  }
}

async function handleBlobReady(blobData, mimeType, size) {
  console.log('[Background] handleBlobReady - size:', size, 'bytes');
  
  try {
    // Validate
    if (!blobData || size === 0) {
      throw new Error('Invalid blob data');
    }
    
    if (size < 10000) {
      throw new Error(`Blob too small (${size} bytes)`);
    }
    
    // Convert
    const response = await fetch(blobData);
    const videoBlob = await response.blob();
    
    console.log('[Background] Blob converted:', videoBlob.size, 'bytes');
    
    // Save recording name before reset
    const recordingName = recordingState.name;
    
    // CRITICAL: Reset state BEFORE upload (so popup shows correct state)
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
    // State already reset above
    showNotification('Error', 'Failed to process recording: ' + error.message);
  }
}

function handleOffscreenError(errorMessage) {
  console.error('[Background] Offscreen error:', errorMessage);
  
  // CRITICAL: Reset state on offscreen error
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
  
  // Clear timeout
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }
  
  // Reset state
  recordingState = {
    isRecording: false,
    name: '',
    startTime: null,
    tabId: null
  };
  
  // Update UI
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
    justification: 'Record video and audio from tab with microphone',
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
  forceResetState(); // Ensure clean state
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension started');
  forceResetState(); // Ensure clean state
});
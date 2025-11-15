/**
 * POAi v2.0 - Background Service Worker
 * Manages recording state and coordinates between popup and offscreen document
 */

// Recording state (source of truth)
let recordingState = {
  isRecording: false,
  name: '',
  startTime: null,
  tabId: null
};

console.log('[Background] POAi v2.0 service worker initialized');

// ==================== Message Listener ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Received message:', request.action);
  
  if (request.action === 'startRecording') {
    handleStartRecording(request.recordingName)
      .then((startTime) => {
        console.log('[Background] Start recording successful');
        sendResponse({ success: true, startTime });
      })
      .catch(error => {
        console.error('[Background] Start recording failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response

  } else if (request.action === 'stopRecording') {
    handleStopRecording()
      .then((result) => {
        console.log('[Background] Stop recording successful');
        sendResponse(result);
      })
      .catch(error => {
        console.error('[Background] Stop recording failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;

  } else if (request.action === 'getRecordingStatus') {
    console.log('[Background] Status request - isRecording:', recordingState.isRecording);
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
  }
});

// ==================== Tab Management ====================

chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState.isRecording && recordingState.tabId === tabId) {
    console.warn('[Background] Recorded tab closed, stopping recording');
    handleStopRecording().catch(err => 
      console.error('[Background] Error stopping after tab close:', err)
    );
  }
});

// ==================== Core Functions ====================

async function handleStartRecording(recordingName) {
  console.log('[Background] handleStartRecording called:', recordingName);
  
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }
  
  console.log('[Background] Active tab:', tab.id, tab.url);
  
  // Check if already recording
  if (recordingState.isRecording) {
    throw new Error('Recording already in progress');
  }

  // Check for restricted URLs
  if (tab.url?.startsWith('chrome://') || 
      tab.url?.startsWith('chrome-extension://') ||
      tab.url?.startsWith('edge://') ||
      tab.url?.startsWith('about:')) {
    throw new Error('Cannot record browser internal pages. Please navigate to a website.');
  }

  // Set recording state
  const startTime = Date.now();
  recordingState = {
    isRecording: true,
    name: recordingName,
    startTime: startTime,
    tabId: tab.id
  };
  
  console.log('[Background] Recording state set');

  // Get stream ID from tabCapture
  console.log('[Background] Requesting tabCapture stream...');
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });
    console.log('[Background] Got streamId:', streamId);
  } catch (err) {
    console.error('[Background] tabCapture failed:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Permission denied. Please select a tab to share audio and video.');
  }

  // Setup offscreen document
  console.log('[Background] Setting up offscreen document...');
  try {
    await setupOffscreenDocument();
  } catch (err) {
    console.error('[Background] Offscreen setup failed:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Failed to initialize recording environment');
  }

  // Start offscreen recording
  console.log('[Background] Starting offscreen recording...');
  try {
    await chrome.runtime.sendMessage({
      action: 'startOffscreenRecording',
      streamId: streamId,
      tabId: tab.id
    });
  } catch (err) {
    console.error('[Background] Failed to start offscreen recording:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Failed to start recording: ' + err.message);
  }

  // Update badge
  updateBadge(true);
  
  // Start keep-alive
  startKeepAlive();
  
  console.log('[Background] Recording started successfully');
  return startTime;
}

async function handleStopRecording() {
  console.log('[Background] handleStopRecording called');
  
  if (!recordingState.isRecording) {
    console.warn('[Background] Not currently recording');
    return { success: false, error: 'No active recording' };
  }

  console.log('[Background] Sending stop signal to offscreen...');
  
  try {
    await chrome.runtime.sendMessage({ action: 'stopOffscreenRecording' });
    console.log('[Background] Stop signal sent successfully');
  } catch (sendError) {
    console.error('[Background] Error sending stop signal:', sendError);
    // Continue anyway - offscreen might be handling it
  }

  // Note: We don't reset state here - wait for blobReady
  return { success: true, message: 'Stop signal sent' };
}

async function handleBlobReady(blobData, mimeType, size) {
  console.log('[Background] handleBlobReady called');
  console.log('[Background] Blob size:', size, 'bytes');
  console.log('[Background] Blob type:', mimeType);
  
  try {
    // Validate blob data
    if (!blobData) {
      throw new Error('No blob data received');
    }
    
    if (size === 0 || size < 1000) {
      throw new Error('Blob is empty or too small (likely corrupted)');
    }
    
    // Convert base64 to Blob
    console.log('[Background] Converting base64 to Blob...');
    const response = await fetch(blobData);
    const videoBlob = await response.blob();
    
    console.log('[Background] Blob converted, actual size:', videoBlob.size);
    
    // Save recording name
    const recordingName = recordingState.name;
    
    // Reset state
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    stopKeepAlive();
    
    // Close offscreen document
    console.log('[Background] Closing offscreen document...');
    try {
      await chrome.offscreen.closeDocument();
      console.log('[Background] Offscreen document closed');
    } catch (e) {
      console.warn('[Background] Offscreen already closed:', e.message);
    }
    
    // Upload to server
    await uploadToServer(videoBlob, recordingName, mimeType);
    
  } catch (error) {
    console.error('[Background] Error handling blob:', error);
    
    // Reset state on error
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    stopKeepAlive();
    
    // Notify user
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'POAi - Recording Error',
      message: 'Failed to process recording: ' + error.message
    });
  }
}

async function uploadToServer(videoBlob, recordingName, mimeType) {
  console.log('[Background] uploadToServer called');
  console.log('[Background] Recording name:', recordingName);
  console.log('[Background] Blob size:', videoBlob.size, 'bytes');
  console.log('[Background] MIME type:', mimeType);
  
  try {
    // Prepare form data
    const formData = new FormData();
    
    // Determine file extension
    const getExtension = (type) => {
      if (!type) return 'webm';
      if (/webm/.test(type)) return 'webm';
      if (/mp4/.test(type)) return 'mp4';
      if (/ogg/.test(type)) return 'ogg';
      return 'webm';
    };
    
    const extension = getExtension(mimeType);
    const sanitizedName = recordingName.replace(/[<>:"/\\|?*]/g, '_');
    const filename = `${sanitizedName}.${extension}`;
    
    console.log('[Background] Filename:', filename);
    
    // Append file and metadata
    formData.append('video', videoBlob, filename);
    formData.append('title', sanitizedName);
    
    console.log('[Background] Uploading to http://127.0.0.1:5000/upload...');
    
    // Upload with long timeout (30 minutes for large files)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 minutes
    
    const response = await fetch('http://127.0.0.1:5000/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    console.log('[Background] Upload response status:', response.status);
    
    // Parse response
    const result = await response.json();
    console.log('[Background] Upload result:', result);
    
    if (!response.ok) {
      throw new Error(result.error || `Server error: ${response.status}`);
    }
    
    // Success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'POAi - Upload Complete',
      message: `"${sanitizedName}" uploaded successfully. Processing in background...`
    });
    
    console.log('[Background] Upload completed successfully');
    
  } catch (error) {
    console.error('[Background] Upload error:', error);
    
    // Determine error message
    let errorMessage = 'Upload failed';
    if (error.name === 'AbortError') {
      errorMessage = 'Upload timed out after 30 minutes. File may be too large.';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Cannot connect to server. Is POAi running on http://127.0.0.1:5000?';
    } else {
      errorMessage = error.message;
    }
    
    // Error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'POAi - Upload Failed',
      message: errorMessage
    });
    
    throw error;
  }
}

// ==================== Helper Functions ====================

async function setupOffscreenDocument() {
  console.log('[Background] setupOffscreenDocument called');
  
  // Check if offscreen document already exists
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
    justification: 'Record video and audio from tab with microphone mixing and audio monitoring',
  });
  
  console.log('[Background] Offscreen document created');
}

function updateBadge(recording) {
  if (recording) {
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
    console.log('[Background] Badge set to recording');
  } else {
    chrome.action.setBadgeText({ text: '' });
    console.log('[Background] Badge cleared');
  }
}

// ==================== Keep-Alive Mechanism ====================

let keepAliveInterval;

function startKeepAlive() {
  if (keepAliveInterval) return;
  
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // Just to keep service worker alive
    });
  }, 20000); // Every 20 seconds
  
  console.log('[Background] Keep-alive started');
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('[Background] Keep-alive stopped');
  }
}

// ==================== Extension Lifecycle ====================

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] POAi v2.0 extension installed');
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] POAi v2.0 extension started');
});
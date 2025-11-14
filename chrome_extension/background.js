/**
 * POAi v2.0 - Background Service Worker
 * 
 * CRITICAL FIX: Proper blob handling with blob-ready message
 * Prevents file corruption by waiting for complete blob
 */

let recordingState = {
  isRecording: false,
  name: '',
  startTime: null,
  tabId: null
};

// Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    startRecording(request.recordingName)
      .then((startTime) => sendResponse({ success: true, startTime }))
      .catch(error => {
        console.error('[Background] Start error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;

  } else if (request.action === 'stopRecording') {
    stopRecording()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;

  } else if (request.action === 'getRecordingStatus') {
    sendResponse({ 
      isRecording: recordingState.isRecording, 
      recordingData: recordingState.isRecording ? recordingState : null 
    });
    return true;

  } else if (request.action === 'blobReady') {
    // CRITICAL FIX: New message from offscreen when blob is ready
    handleBlobReady(request.blobData, request.mimeType, request.size);
    sendResponse({ success: true });
    return true;
  }
});

// Tab Management
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState.isRecording && recordingState.tabId === tabId) {
    console.warn('[Background] Recorded tab closed, stopping...');
    stopRecording().catch(err => console.error('[Background] Error stopping:', err));
  }
});

// Start Recording
async function startRecording(recordingName) {
  console.log('[Background] Starting recording:', recordingName);
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }
  
  if (recordingState.isRecording) {
    throw new Error('Recording already in progress');
  }

  // Check for restricted URLs
  if (tab.url?.startsWith('chrome://') || 
      tab.url?.startsWith('chrome-extension://') ||
      tab.url?.startsWith('edge://') ||
      tab.url?.startsWith('about:')) {
    throw new Error('Cannot record browser internal pages');
  }

  const startTime = Date.now();
  recordingState = {
    isRecording: true,
    name: recordingName,
    startTime: startTime,
    tabId: tab.id
  };
  
  console.log('[Background] State set, requesting tab capture...');

  // Get streamId
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });
    console.log('[Background] Got streamId:', streamId);
  } catch (err) {
    console.error('[Background] tabCapture failed:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Permission denied. Select tab to share.');
  }

  // Setup offscreen document
  try {
    await setupOffscreenDocument('offscreen.html');
  } catch (err) {
    console.error('[Background] Offscreen setup failed:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Failed to initialize recording');
  }

  // Start offscreen recording
  try {
    await chrome.runtime.sendMessage({
      action: 'startOffscreenRecording',
      streamId: streamId,
      tabId: tab.id
    });
  } catch (err) {
    console.error('[Background] Start offscreen failed:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Failed to start recording');
  }

  updateBadge(true);
  console.log('[Background] Recording started successfully');
  return startTime;
}

async function stopRecording() {
  console.log('[Background] Stop recording called');
  
  if (!recordingState.isRecording) {
    console.warn('[Background] Not recording');
    return { success: false, error: 'No active recording' };
  }

  // CRITICAL FIX: Just send stop message, don't wait for blob here
  try {
    await chrome.runtime.sendMessage({ action: 'stopOffscreenRecording' });
    console.log('[Background] Stop signal sent to offscreen');
  } catch (sendError) {
    console.error('[Background] Error sending stop:', sendError);
  }

  // Note: We don't reset state here - we wait for blobReady message
  return { success: true, message: 'Stop signal sent, waiting for blob' };
}

async function handleBlobReady(blobData, mimeType, size) {
  console.log('[Background] Blob ready received');
  console.log('[Background] Size:', size, 'bytes');
  console.log('[Background] Type:', mimeType);
  
  try {
    // Convert base64 to Blob
    const response = await fetch(blobData);
    const videoBlob = await response.blob();
    
    console.log('[Background] Blob converted, size:', videoBlob.size);
    
    // Validate blob
    if (videoBlob.size === 0) {
      throw new Error('Received empty blob');
    }
    
    if (videoBlob.size < 1000) {
      throw new Error('Blob too small, likely corrupted');
    }
    
    // Get recording name before resetting state
    const recordingName = recordingState.name;
    
    // Reset state
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    
    // Close offscreen document
    try {
      await chrome.offscreen.closeDocument();
      console.log('[Background] Offscreen document closed');
    } catch (e) {
      console.warn('[Background] Offscreen already closed:', e.message);
    }
    
    // Upload to server
    await uploadVideoToServer(videoBlob, recordingName, mimeType);
    
  } catch (error) {
    console.error('[Background] Error handling blob:', error);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'POAi - Recording Error',
      message: 'Failed to process recording: ' + error.message
    });
  }
}

async function uploadVideoToServer(videoBlob, recordingName, mimeType) {
  console.log('[Background] Uploading to server...');
  
  try {
    const formData = new FormData();

    // Determine extension
    const getExtension = (type) => {
      if (!type) return 'webm';
      if (/webm/.test(type)) return 'webm';
      if (/mp4/.test(type)) return 'mp4';
      if (/mkv/.test(type)) return 'mkv';
      return 'webm';
    };

    const extension = getExtension(mimeType);
    const sanitizedName = recordingName.replace(/[<>:"/\\|?*]/g, '_');
    const filename = `${sanitizedName}.${extension}`;
    
    console.log('[Background] Filename:', filename);
    console.log('[Background] Size:', (videoBlob.size / (1024*1024)).toFixed(2), 'MB');
    
    formData.append('video', videoBlob, filename);
    formData.append('title', sanitizedName);

    // Upload with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

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

    console.log('[Background] Upload successful:', result);

    // Notify user
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'POAi - Processing Started',
      message: `"${sanitizedName}" uploaded. Processing in background...`
    });

  } catch (error) {
    console.error('[Background] Upload error:', error);
    
    let errorMessage = 'Upload failed';
    if (error.name === 'AbortError') {
      errorMessage = 'Upload timed out. File may be too large.';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Cannot connect to server. Is POAi running?';
    } else {
      errorMessage = error.message;
    }
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'POAi - Upload Error',
      message: errorMessage
    });
  }
}

function updateBadge(recording) {
  if (recording) {
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function setupOffscreenDocument(path) {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    console.log('[Background] Offscreen document exists');
    return;
  }

  console.log('[Background] Creating offscreen document...');
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['USER_MEDIA'],
    justification: 'Record video and audio with tab monitoring',
  });
}

// Keep service worker alive
let keepAliveInterval;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
  console.log('[Background] Keep-alive started');
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('[Background] Keep-alive stopped');
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'startRecording') {
    startKeepAlive();
  } else if (request.action === 'blobReady') {
    stopKeepAlive();
  }
});
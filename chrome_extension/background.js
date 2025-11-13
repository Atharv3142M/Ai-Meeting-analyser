// Service Worker - Manages recording state and uploads video files

let recordingState = {
  isRecording: false,
  name: '',
  startTime: null,
  tabId: null
};

// Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    startRecording(request.recordingName, request.tabId)
      .then((startTime) => sendResponse({ success: true, startTime }))
      .catch(error => {
        console.error('Start recording error:', error);
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

  } else if (request.action === 'recordingStopped') {
    handleRecordingStopped(request.audioBlob, request.mimeType);
    sendResponse({ success: true });
    return true;
  }
});

// Tab Management
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState.isRecording && recordingState.tabId === tabId) {
    console.warn('Recorded tab was closed! Stopping recording.');
    stopRecording().catch(err => console.error('Error stopping after tab close:', err));
  }
});

// Start Recording
async function startRecording(recordingName) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }
  
  if (recordingState.isRecording) {
    throw new Error('Recording is already in progress.');
  }

  // Check for restricted URLs
  if (tab.url?.startsWith('chrome://') || 
      tab.url?.startsWith('chrome-extension://') ||
      tab.url?.startsWith('edge://') ||
      tab.url?.startsWith('about:')) {
    throw new Error('Cannot record on browser internal pages. Please navigate to a website.');
  }

  const startTime = Date.now();
  recordingState = {
    isRecording: true,
    name: recordingName,
    startTime: startTime,
    tabId: tab.id
  };
  
  console.log('Recording state set. Starting tab capture...');

  // Get streamId with tab permission
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });
    console.log('Got streamId:', streamId);
  } catch (err) {
    console.error('tabCapture.getMediaStreamId failed:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Permission denied. You must select a tab to share.');
  }

  // Setup offscreen document
  try {
    await setupOffscreenDocument('offscreen.html');
  } catch (err) {
    console.error('Error setting up offscreen document:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Failed to initialize recording environment.');
  }

  // Start offscreen recording
  try {
    await chrome.runtime.sendMessage({
      action: 'startOffscreenRecording',
      streamId: streamId,
      tabId: tab.id
    });
  } catch (err) {
    console.error('Error starting offscreen recording:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Failed to start recording.');
  }

  updateBadge(true);
  console.log('Recording started successfully with video + audio monitoring');
  return startTime;
}

async function stopRecording() {
  if (!recordingState.isRecording) {
    console.warn('Stop called but not recording.');
    return { success: false, error: 'No active recording' };
  }

  try {
    await chrome.runtime.sendMessage({ action: 'stopOffscreenRecording' });
  } catch (sendError) {
    console.error('Error sending stop message:', sendError);
  }

  return { success: true, message: 'Stop signal sent' };
}

async function handleRecordingStopped(videoBlobData, mimeType) {
  console.log('Recording stopped. Processing video...');
  
  try {
    // Convert base64 to Blob
    const response = await fetch(videoBlobData);
    const videoBlob = await response.blob();
    
    console.log('Video blob created, size:', videoBlob.size, 'type:', mimeType);
    
    // Reset recording state
    const recordingName = recordingState.name;
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    
    // Close offscreen document
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {
      console.warn('Offscreen document already closed:', e.message);
    }
    
    // Upload to server
    await uploadVideoToServer(videoBlob, recordingName, mimeType);
  } catch (error) {
    console.error('Error in handleRecordingStopped:', error);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Recording Error',
      message: 'Failed to process recording: ' + error.message
    });
  }
}

async function uploadVideoToServer(videoBlob, recordingName, mimeType) {
  try {
    console.log('Uploading video to local server: http://127.0.0.1:5000/upload');
    
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
    
    console.log(`Uploading file as: ${filename} (${(videoBlob.size / (1024*1024)).toFixed(2)}MB)`);
    
    // Use 'video' key instead of 'audio' for backend
    formData.append('video', videoBlob, filename);
    formData.append('title', sanitizedName);

    // Upload with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout for video

    const response = await fetch('http://127.0.0.1:5000/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `Server returned status ${response.status}`);
    }

    console.log('Server response:', result);

    // Notify user
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Processing Started!',
      message: `"${sanitizedName}" uploaded successfully. Processing in background...`
    });

  } catch (error) {
    console.error('Error uploading video:', error);
    
    let errorMessage = 'Could not connect or process.';
    if (error.name === 'AbortError') {
      errorMessage = 'Upload timed out. File may be too large.';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Could not connect. Is your Python server running on port 5000?';
    } else {
      errorMessage = error.message;
    }
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Upload Error',
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
    console.log('Offscreen document already exists.');
    return;
  }

  console.log('Creating offscreen document...');
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['USER_MEDIA'],
    justification: 'To record video and audio from tab with monitoring capability',
  });
}

// Keep service worker alive
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

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'startRecording') {
    startKeepAlive();
  } else if (request.action === 'stopRecording') {
    stopKeepAlive();
  }
});
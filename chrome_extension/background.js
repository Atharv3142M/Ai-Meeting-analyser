// Service Worker - Manages recording state and communication with local server

// This is the "source of truth" for the recording state.
let recordingState = {
  isRecording: false,
  name: '',
  startTime: null,
  tabId: null
};

// --- Message Listener ---
// This is the main router for the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    startRecording(request.recordingName, request.tabId)
      .then((startTime) => sendResponse({ success: true, startTime }))
      .catch(error => {
        console.error('Start recording error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicates async response

  } else if (request.action === 'stopRecording') {
    stopRecording()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Indicates async response

  } else if (request.action === 'getRecordingStatus') {
    // Popup is asking for the current state
    sendResponse({ 
      isRecording: recordingState.isRecording, 
      recordingData: recordingState.isRecording ? recordingState : null 
    });
    return true;

  } else if (request.action === 'recordingStopped') {
    // This message now comes from offscreen.js
    handleRecordingStopped(request.audioBlob, request.mimeType);
    sendResponse({ success: true });
    return true;
  }
});

// --- Tab Management ---
// Stop recording if the tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState.isRecording && recordingState.tabId === tabId) {
    console.warn('Recorded tab was closed! Stopping recording.');
    stopRecording().catch(err => console.error('Error stopping after tab close:', err));
  }
});

// --- Core Functions ---

async function startRecording(recordingName) {
  // 1. Get current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }
  
  if (recordingState.isRecording) {
    throw new Error('Recording is already in progress.');
  }

  // 2. Check for restricted URLs
  if (tab.url?.startsWith('chrome://') || 
      tab.url?.startsWith('chrome-extension://') ||
      tab.url?.startsWith('edge://') ||
      tab.url?.startsWith('about:')) {
    throw new Error('Cannot record on browser internal pages. Please navigate to a website like youtube.com.');
  }

  const startTime = Date.now();
  // 3. Set global recording state *before* showing prompt
  recordingState = {
    isRecording: true,
    name: recordingName,
    startTime: startTime,
    tabId: tab.id
  };
  
  console.log('Recording state set. Starting tab capture...');

  // 4. Start Tab Capture
  // This is the "Share Screen" prompt the user wanted
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });
    console.log('Got streamId:', streamId);
  } catch (err) {
    console.error('tabCapture.getMediaStreamId failed:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Permission denied. You must select a tab to share audio.');
  }

  // 5. Start the Offscreen Document to handle recording
  try {
    await setupOffscreenDocument('offscreen.html');
  } catch (err) {
    console.error('Error setting up offscreen document:', err);
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Failed to initialize recording environment.');
  }

  // 6. Send the streamId to the offscreen document to start the MediaRecorder
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
  console.log('Recording started successfully');
  return startTime;
}

async function stopRecording() {
  if (!recordingState.isRecording) {
    console.warn('Stop called but not recording.');
    return { success: false, error: 'No active recording' };
  }

  // Send message to offscreen.js to stop capture
  try {
    await chrome.runtime.sendMessage({ action: 'stopOffscreenRecording' });
  } catch (sendError) {
    console.error('Error sending stop message:', sendError);
    // This can happen if the offscreen doc was closed.
    // We'll still try to clean up state
  }

  // State will be fully reset in handleRecordingStopped
  return { success: true, message: 'Stop signal sent' };
}

async function handleRecordingStopped(audioBlobData, mimeType) {
  console.log('Recording stopped. Processing audio...');
  
  try {
    // 1. Convert base64 data URL back to a Blob
    const response = await fetch(audioBlobData);
    const audioBlob = await response.blob();
    
    console.log('Audio blob created, size:', audioBlob.size, 'type:', mimeType);
    
    // 2. Reset recording state
    const recordingName = recordingState.name; // Keep name for filename
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    
    // 3. Close the offscreen document
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {
      console.warn('Offscreen document already closed:', e.message);
    }
    
    // 4. Send to local server
    await processAudioLocal(audioBlob, recordingName, mimeType);
  } catch (error) {
    console.error('Error in handleRecordingStopped:', error);
    // Reset state even on error
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

async function processAudioLocal(audioBlob, recordingName, mimeType) {
  try {
    console.log('Sending audio to local server: http://127.0.0.1:5000/upload');
    
    const formData = new FormData();

    // Determine the correct extension from the mimeType
    const getExtension = (type) => {
      if (!type) return 'webm'; // Default fallback
      if (/webm/.test(type)) return 'webm';
      if (/ogg/.test(type)) return 'ogg';
      if (/mp4/.test(type)) return 'mp4';
      if (/wav/.test(type)) return 'wav';
      return 'webm'; // Default fallback
    };

    const extension = getExtension(mimeType);
    // Sanitize filename to remove invalid characters
    const sanitizedName = recordingName.replace(/[<>:"/\\|?*]/g, '_');
    const filename = `${sanitizedName}.${extension}`;
    
    console.log(`Uploading file as: ${filename} (type: ${mimeType})`);
    formData.append('audio', audioBlob, filename);

    // Upload to the Python server with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

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

    // Notify user of success
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Processing Complete!',
      message: `"${sanitizedName}" was transcribed and summarized successfully.`
    });

  } catch (error) {
    console.error('Error processing audio locally:', error);
    
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
      title: 'Processing Error',
      message: errorMessage
    });
  }
}

// --- Badge Utility ---
function updateBadge(recording) {
  if (recording) {
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// --- Offscreen Document Management ---
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
    justification: 'To record audio from tabCapture and microphone streams',
  });
}

// Keep service worker alive during recording
let keepAliveInterval;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // Just to keep the service worker alive
    });
  }, 20000); // Every 20 seconds
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Start keep-alive when recording starts
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'startRecording') {
    startKeepAlive();
  } else if (request.action === 'stopRecording') {
    stopKeepAlive();
  }
});
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
  // --- From popup.js ---
  if (request.action === 'startRecording') {
    startRecording(request.recordingName)
      .then(() => sendResponse({ success: true }))
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
    return true; // Sync response but good practice

  // --- From recorder.js ---
  } else if (request.action === 'recordingStopped') {
    // Pass the new mimeType variable
    handleRecordingStopped(request.audioBlob, request.mimeType);
    sendResponse({ success: true });
    return true; // Indicates async response
  }
});

// --- Tab Management ---
// Stop recording if the tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState.isRecording && recordingState.tabId === tabId) {
    console.warn('Recorded tab was closed! Stopping recording.');
    // Reset state
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Recording Stopped',
      message: 'The tab you were recording was closed.'
    });
  }
});

// --- Core Functions ---

async function startRecording(recordingName) {
  // 1. Get current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }

  // 2. Check for restricted URLs
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    throw new Error('Cannot record on Chrome internal pages. Please use on a website like google.com.');
  }

  // 3. Set global recording state
  recordingState = {
    isRecording: true,
    name: recordingName,
    startTime: Date.now(),
    tabId: tab.id
  };

  // 4. Inject the recorder.js script into the tab
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['recorder.js']
    });
  } catch (injectError) {
    console.error('Error injecting script:', injectError);
    // Reset state on failure
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error('Could not inject recorder into the page.');
  }

  // 5. Send message to recorder.js to start capture
  const response = await chrome.tabs.sendMessage(tab.id, {
    action: 'startCapture'
  });

  if (!response || !response.success) {
    // Reset state on failure
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    throw new Error(response?.error || 'Failed to start audio capture in the tab.');
  }

  updateBadge(true);
  console.log('Recording started successfully');
}

async function stopRecording() {
  if (!recordingState.isRecording || !recordingState.tabId) {
    console.warn('Stop called but not recording.');
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    return { success: false, error: 'No active recording' };
  }

  // Send message to recorder.js to stop capture
  try {
    await chrome.tabs.sendMessage(recordingState.tabId, {
      action: 'stopCapture'
    });
  } catch (sendError) {
    console.error('Error sending stop message:', sendError);
    // This can happen if the tab was closed. Reset state.
    recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
    updateBadge(false);
    return { success: false, error: 'Tab was closed or disconnected.' };
  }
  
  return { success: true, message: 'Stop signal sent' };
}

async function handleRecordingStopped(audioBlobData, mimeType) {
  console.log('Recording stopped. Processing audio...');
  
  // 1. Convert base64 data URL back to a Blob
  const response = await fetch(audioBlobData);
  const audioBlob = await response.blob();
  
  console.log('Audio blob created, size:', audioBlob.size, 'type:', mimeType);
  
  // 2. Reset recording state
  const recordingName = recordingState.name; // Keep name for filename
  recordingState = { isRecording: false, name: '', startTime: null, tabId: null };
  updateBadge(false);
  
  // 3. Send to local server
  await processAudioLocal(audioBlob, recordingName, mimeType);
}

// --- This function contains the FFMPEG BUG FIX ---
async function processAudioLocal(audioBlob, recordingName, mimeType) {
  try {
    console.log('Sending audio to local server: http://127.0.0.1:5000/upload');
    
    const formData = new FormData();

    // *** THIS IS THE FFMPEG FIX ***
    // We determine the correct extension from the mimeType,
    // not just assume .webm
    const getExtension = (type) => {
      if (!type) return 'webm'; // Default fallback
      if (/webm/.test(type)) return 'webm';
      if (/ogg/.test(type)) return 'ogg';
      if (/mp4/.test(type)) return 'mp4';
      if (/wav/.test(type)) return 'wav';
      return 'webm'; // Default fallback
    };

    const extension = getExtension(mimeType);
    const filename = `${recordingName}.${extension}`;
    
    console.log(`Uploading file as: ${filename}`);
    formData.append('audio', audioBlob, filename);

    // 1. Upload to the Python server
    const response = await fetch('http://127.0.0.1:5000/upload', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Server returned an error');
    }

    console.log('Server response:', result);

    // 2. Notify user of success
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Processing Complete!',
      message: `"${recordingName}" was transcribed and summarized successfully.`
    });

  } catch (error) {
    console.error('Error processing audio locally:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Local Server Error',
      message: 'Could not connect or process. Is your Python server running?'
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
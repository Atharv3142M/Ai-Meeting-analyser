// POAi v2.0 Service Worker - Robust Version

// 1. State Management
const updateRecordingState = async (active, type) => {
  console.log("Updating state:", { active, type });
  await chrome.storage.local.set({ recording: active, type: type });
  
  const iconPath = active ? "icons/recording.png" : "icons/not-recording.png";
  chrome.action.setIcon({ path: iconPath });
};

// 2. Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Service Worker received message:", request);

  switch (request.type) {
    case "start-recording":
      startRecording(request.recordingType);
      break;
    case "stop-recording":
      stopRecording();
      break;
    case "open-tab": // This message comes from offscreen.js or desktopRecord.js when recording is done
      handleRecordingFinished(request);
      break;
  }
  return true;
});

// 3. Start Recording Logic
const startRecording = async (type) => {
  await updateRecordingState(true, type);

  if (type === "tab") {
    await setupOffscreenDocument("offscreen.html");
    
    // Get the stream ID for the current tab
    const tab = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab[0]) return;
    
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab[0].id });
    
    // Send to offscreen document to start recording
    chrome.runtime.sendMessage({
      type: "start-recording",
      target: "offscreen",
      data: streamId
    });
  } 
  else if (type === "screen") {
    // Create the pinned tab for desktop capture
    const desktopRecordUrl = chrome.runtime.getURL("desktopRecord.html");
    const newTab = await chrome.tabs.create({
      url: desktopRecordUrl,
      pinned: true,
      active: true,
      index: 0
    });
    
    // Wait a moment for the tab to load, then trigger it
    setTimeout(() => {
      chrome.tabs.sendMessage(newTab.id, { type: "start-recording" });
    }, 500);
  }
};

// 4. Stop Recording Logic
const stopRecording = async () => {
  await updateRecordingState(false, "");
  
  // Send stop message to EVERYONE (offscreen and tabs) just to be safe
  chrome.runtime.sendMessage({ type: "stop-recording", target: "offscreen" });
  
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { type: "stop-recording" }).catch(() => {});
  });
};

// 5. Handle Finished Recording (Upload to Python)
const handleRecordingFinished = async (data) => {
  console.log("Recording finished. Data received.");
  const { url, base64 } = data;
  
  // We prioritize base64 if available, otherwise fetch the blob url
  let blob;
  
  try {
    if (base64) {
      const res = await fetch(base64);
      blob = await res.blob();
    } else if (url) {
      const res = await fetch(url);
      blob = await res.blob();
    } else {
      console.error("No video data received!");
      return;
    }

    await uploadToPythonBackend(blob);

    // Clean up: Close the desktop record tab if it exists
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("desktopRecord.html") });
    if (tabs.length > 0) {
      chrome.tabs.remove(tabs[0].id);
    }
    
    // Open the Python Dashboard
    chrome.tabs.create({ url: 'http://127.0.0.1:5000' });

  } catch (err) {
    console.error("Error processing recording:", err);
  }
};

// 6. Upload to Python Backend
const uploadToPythonBackend = async (blob) => {
  const API_BASE_URL = 'http://127.0.0.1:5000';
  console.log("🚀 Uploading to POAi backend...");

  try {
    const formData = new FormData();
    const filename = `recording_${Date.now()}.webm`;
    
    formData.append('video', blob, filename);
    formData.append('title', 'Screen Recording'); // Default title

    const response = await fetch(`${API_BASE_URL}/upload`, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      console.log("✅ Upload successful");
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/recording.png',
        title: 'POAi Upload Complete',
        message: 'Recording uploaded for processing.'
      });
    } else {
      throw new Error(`Server error: ${response.status}`);
    }
  } catch (error) {
    console.error("❌ Upload failed:", error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/not-recording.png',
      title: 'Upload Failed',
      message: 'Could not connect to Python server.'
    });
  }
};

// Helper: Ensure offscreen doc exists
const setupOffscreenDocument = async (path) => {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: path,
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
      justification: 'Recording tab audio/video',
    });
  }
};
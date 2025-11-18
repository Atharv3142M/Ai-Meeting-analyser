// check
const checkRecording = async () => {
  const recording = await chrome.storage.local.get(["recording", "type"]);
  const recordingStatus = recording.recording || false;
  const recordingType = recording.type || "";
  console.log("recording status", recordingStatus, recordingType);
  return [recordingStatus, recordingType];
};

// update recording state
const updateRecording = async (state, type) => {
  console.log("update recording", type);
  chrome.storage.local.set({ recording: state, type });
};

const injectCamera = async () => {
  // inject the content script into the current page
  const tab = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const tabId = tab[0].id;
  console.log("inject into tab", tabId);
  await chrome.scripting.executeScript({
    // content.js is the file that will be injected
    files: ["content.js"],
    target: { tabId },
  });
};

const removeCamera = async () => {
  // inject the content script into the current page
  const tab = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const tabId = tab[0].id;
  console.log("inject into tab", tabId);
  await chrome.scripting.executeScript({
    // content.js is the file that will be injected
    func: () => {
      const camera = document.querySelector("#rusty-camera");
      if (!camera) return;
      document.querySelector("#rusty-camera").style.display = "none";
    },
    target: { tabId },
  });
};

// listen for changes to the focused / current tab
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log("tab activated", activeInfo);

  // grab the tab
  const activeTab = await chrome.tabs.get(activeInfo.tabId);
  if (!activeTab) return;
  const tabUrl = activeTab.url;

  // if chrome or extension page, return
  if (
    tabUrl.startsWith("chrome://") ||
    tabUrl.startsWith("chrome-extension://")
  ) {
    console.log("chrome or extension page - exiting");
    return;
  }

  // check if we are recording & if we are recording the scren
  const [recording, recordingType] = await checkRecording();

  console.log("recording check after tab change", {
    recording,
    recordingType,
    tabUrl,
  });

  if (recording && recordingType === "screen") {
    // inject the camera
    injectCamera();
  } else {
    // remove the camera
    removeCamera();
  }
});

const startRecording = async (type) => {
  console.log("start recording", type);
  const currentstate = await checkRecording();
  console.log("current state", currentstate);
  updateRecording(true, type);
  // update the icon
  chrome.action.setIcon({ path: "icons/recording.png" });
  if (type === "tab") {
    recordTabState(true);
  }
  if (type === "screen") {
    recordScreen();
  }
};

const stopRecording = async () => {
  console.log("stop recording");
  updateRecording(false, "");
  // update the icon
  chrome.action.setIcon({ path: "icons/not-recording.png" });
  recordTabState(false);
};

const recordScreen = async () => {
  // create a pinned focused tab - with an index of 0
  const desktopRecordPath = chrome.runtime.getURL("desktopRecord.html");

  const currentTab = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const currentTabId = currentTab[0].id;

  const newTab = await chrome.tabs.create({
    url: desktopRecordPath,
    pinned: true,
    active: true,
    index: 0,
  });

  // wait for 500ms send a message to the tab to start recording
  setTimeout(() => {
    chrome.tabs.sendMessage(newTab.id, {
      type: "start-recording",
      focusedTabId: currentTabId,
    });
  }, 500);
};

const recordTabState = async (start = true) => {
  // setup our offscrene document
  const existingContexts = await chrome.runtime.getContexts({});
  const offscreenDocument = existingContexts.find(
    (c) => c.contextType === "OFFSCREEN_DOCUMENT"
  );

  // If an offscreen document is not already open, create one.
  if (!offscreenDocument) {
    // Create an offscreen document.
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "DISPLAY_MEDIA"],
      justification: "Recording from chrome.tabCapture API",
    });
  }

  if (start) {
    // use the tapCapture API to get the stream
    // get the id of the active tab
    const tab = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const tabId = tab[0].id;

    console.log("tab id", tabId);

    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });

    console.log("stream id", streamId);

    // send this to our offscreen document
    chrome.runtime.sendMessage({
      type: "start-recording",
      target: "offscreen",
      data: streamId,
    });
  } else {
    // stop
    chrome.runtime.sendMessage({
      type: "stop-recording",
      target: "offscreen",
    });
  }
};

const openTabWithVideo = async (message) => {
  console.log("request to open tab with video", message);

  // that message will either have a url or base64 encoded video
  const { url: videoUrl, base64 } = message;

  if (!videoUrl && !base64) return;

  const videoData = videoUrl || base64;

  // *** MODIFIED LOGIC: Send directly to Python Backend ***
  await uploadToPythonBackend(videoData);
  
  // Open the Python dashboard instead of the extension's local player
  chrome.tabs.create({ url: 'http://127.0.0.1:5000' });
};

// *** NEW FUNCTION: Upload to your Python server.py ***
const uploadToPythonBackend = async (videoData) => {
  const API_BASE_URL = 'http://127.0.0.1:5000';
  console.log("🚀 Starting upload to POAi backend...");
  
  try {
    let blob;
    
    // 1. Handle the video data (it might be a blob URL or base64)
    if (videoData.startsWith('blob:')) {
        const response = await fetch(videoData);
        blob = await response.blob();
    } else if (videoData.startsWith('data:')) {
        // Convert base64 to blob
        const res = await fetch(videoData);
        blob = await res.blob();
    } else {
        console.error("Unknown video data format");
        return;
    }
    
    // 2. Create FormData (standard file upload format)
    const formData = new FormData();
    // Use .webm extension as that is what MediaRecorder produces
    const filename = `recording_${Date.now()}.webm`;
    
    // 'video' is the key your server.py expects: request.files.get('video')
    formData.append('video', blob, filename);
    
    // Get current tab title for the recording name
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    const title = tabs[0]?.title || "Screen Recording";
    formData.append('title', title);

    // 3. Send to server.py
    const response = await fetch(`${API_BASE_URL}/upload`, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      const result = await response.json();
      console.log("✅ Upload successful:", result);
      
      // Notify the user
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/recording.png', // Ensure you have this icon or change it
        title: 'POAi Upload Complete',
        message: 'Your recording has been uploaded for processing.'
      });
      
      return result;
    } else {
      const errorText = await response.text();
      console.error("❌ Upload failed:", errorText);
      throw new Error(`Server error: ${response.status}`);
    }

  } catch (error) {
    console.error("❌ Error uploading to backend:", error);
    
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/not-recording.png',
        title: 'POAi Upload Failed',
        message: 'Could not connect to the local server. Is it running?'
      });
    
    throw error;
  }
};

// add listender for messages
chrome.runtime.onMessage.addListener(function (request, sender) {
  console.log("message received", request, sender);

  switch (request.type) {
    case "open-tab":
      openTabWithVideo(request);
      break;
    case "start-recording":
      startRecording(request.recordingType);
      break;
    case "stop-recording":
      stopRecording();
      break;
    default:
      console.log("default");
  }

  return true;
});
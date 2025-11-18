const recordTab = document.querySelector("#tab");
const recordScreen = document.querySelector("#screen");
const tabText = document.querySelector("#tabText");
const screenText = document.querySelector("#screenText");
const recordingIndicator = document.querySelector("#recordingIndicator");
const recordingStatus = document.querySelector("#recordingStatus");
const dashboardLink = document.querySelector("#dashboardLink");

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

// check chrome storage if recording is on
const checkRecording = async () => {
  const recording = await chrome.storage.local.get(["recording", "type"]);
  const recordingStatus = recording.recording || false;
  const recordingType = recording.type || "";
  console.log("recording status", recordingStatus, recordingType);
  return [recordingStatus, recordingType];
};

// Open dashboard
const openDashboard = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  window.close();
};

const updateUI = (isRecording, recordingType) => {
  if (isRecording) {
    recordingIndicator.classList.add("active");
    recordTab.classList.add("stop");
    recordScreen.classList.add("stop");
    
    if (recordingType === "tab") {
      tabText.textContent = "Stop Recording";
      recordingStatus.textContent = "Recording Tab...";
    } else {
      screenText.textContent = "Stop Recording";
      recordingStatus.textContent = "Recording Screen...";
    }
  } else {
    recordingIndicator.classList.remove("active");
    recordTab.classList.remove("stop");
    recordScreen.classList.remove("stop");
    tabText.textContent = "Record Tab";
    screenText.textContent = "Record Screen";
  }
};

const init = async () => {
  const recordingState = await checkRecording();

  console.log("recording state", recordingState);

  updateUI(recordingState[0], recordingState[1]);

  const updateRecording = async (type) => {
    console.log("start recording", type);

    const recordingState = await checkRecording();

    if (recordingState[0] === true) {
      // stop recording
      chrome.runtime.sendMessage({ type: "stop-recording" });
      removeCamera();
    } else {
      // send message to service worker to start recording
      chrome.runtime.sendMessage({
        type: "start-recording",
        recordingType: type,
      });
      injectCamera();
    }

    // close popup
    window.close();
  };

  recordTab.addEventListener("click", async () => {
    console.log("updateRecording tab clicked");
    updateRecording("tab");
  });

  recordScreen.addEventListener("click", async () => {
    console.log("updateRecording screen clicked");
    updateRecording("screen");
  });

  dashboardLink.addEventListener("click", (e) => {
    e.preventDefault();
    openDashboard();
  });
};

init();

const recordTab = document.querySelector("#tab");
const recordScreen = document.querySelector("#screen");
const tabText = document.querySelector("#tabText");
const screenText = document.querySelector("#screenText");
const recordingIndicator = document.querySelector("#recordingIndicator");
const recordingStatus = document.querySelector("#recordingStatus");
const dashboardLink = document.querySelector("#dashboardLink");

// Check state on open
const init = async () => {
  const { recording, type } = await chrome.storage.local.get(["recording", "type"]);
  updateUI(recording, type);
};

const updateUI = (isRecording, type) => {
  if (isRecording) {
    recordingIndicator.classList.add("active");
    
    // If recording, buttons become "Stop" buttons
    if (type === "tab") {
      tabText.textContent = "Stop Recording";
      screenText.textContent = "Record Screen"; // Disable other button visual if needed
      recordTab.classList.add("stop");
    } else {
      screenText.textContent = "Stop Recording";
      tabText.textContent = "Record Tab";
      recordScreen.classList.add("stop");
    }
  } else {
    recordingIndicator.classList.remove("active");
    recordTab.classList.remove("stop");
    recordScreen.classList.remove("stop");
    tabText.textContent = "Record Tab";
    screenText.textContent = "Record Screen";
  }
};

const handleButtonClick = async (clickedType) => {
  const { recording } = await chrome.storage.local.get(["recording"]);

  if (recording) {
    // If currently recording, STOP it
    chrome.runtime.sendMessage({ type: "stop-recording" });
    window.close(); // Close popup
  } else {
    // If not recording, START it
    chrome.runtime.sendMessage({ 
      type: "start-recording", 
      recordingType: clickedType 
    });
    window.close(); // Close popup
  }
};

// Event Listeners
recordTab.addEventListener("click", () => handleButtonClick("tab"));
recordScreen.addEventListener("click", () => handleButtonClick("screen"));

// *** NEW: Open Python Dashboard ***
dashboardLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "http://127.0.0.1:5000" });
});

// Run init
init();
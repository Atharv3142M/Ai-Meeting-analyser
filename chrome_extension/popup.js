// Popup UI Logic - Simplified for local processing

let recording = false;
let recordingInterval;
let seconds = 0;

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const recordingName = document.getElementById('recordingName');
const recordingStatus = document.getElementById('recordingStatus');
const recordingTime = document.getElementById('recordingTime');
const micStatus = document.getElementById('micStatus');
const tabStatus = document.getElementById('tabStatus');

// Start recording
startBtn.addEventListener('click', async () => {
  const name = recordingName.value.trim();
  
  if (!name) {
    alert('Please enter a name for the recording.');
    return;
  }

  // Disable button while starting
  startBtn.disabled = true;
  startBtn.textContent = 'Initializing...';

  // Send message to background to start
  chrome.runtime.sendMessage(
    { action: 'startRecording', recordingName: name },
    (response) => {
      startBtn.disabled = false;
      startBtn.innerHTML = '<span class="icon">⏺️</span> Start Recording';
      
      if (response && response.success) {
        seconds = 0;
        updateUIToRecording();
        micStatus.textContent = 'Capturing audio ✓';
        tabStatus.textContent = 'Capturing audio ✓';
      } else if (response && response.error) {
        alert('Error starting recording: ' + response.error);
        micStatus.textContent = 'Ready to capture ✓';
        tabStatus.textContent = 'Ready to capture ✓';
      }
    }
  );
});

// Stop recording
stopBtn.addEventListener('click', () => {
  stopBtn.disabled = true;
  stopBtn.textContent = 'Processing...';
  
  chrome.runtime.sendMessage(
    { action: 'stopRecording' },
    (response) => {
      stopBtn.disabled = false;
      stopBtn.innerHTML = '<span class="icon">⏹️</span> Finish Recording';
      
      if (response && response.success) {
        updateUIToStopped();
        micStatus.textContent = 'Ready to capture ✓';
        tabStatus.textContent = 'Ready to capture ✓';
        
        alert('Recording finished!\nSending to local server for processing...\nYou will get a notification when it is complete.');
      } else if (response && response.error) {
        alert('Error stopping recording: ' + response.error);
      }
    }
  );
});

// --- UI Update Functions ---

function updateUIToRecording() {
  recording = true;
  startBtn.style.display = 'none';
  stopBtn.style.display = 'flex';
  recordingStatus.classList.add('active');
  recordingName.disabled = true;
  
  recordingInterval = setInterval(() => {
    seconds++;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    recordingTime.textContent = 
      `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, 1000);
}

function updateUIToStopped() {
  recording = false;
  clearInterval(recordingInterval);
  startBtn.style.display = 'flex';
  stopBtn.style.display = 'none';
  recordingStatus.classList.remove('active');
  recordingName.disabled = false;
  recordingTime.textContent = '00:00';
  seconds = 0;
}

// --- Restore State ---
// Check if we are already recording when popup is opened
async function restoreRecordingState() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getRecordingStatus' });
    
    if (response && response.isRecording) {
      const recordingData = response.recordingData || {};
      
      if (recordingData.name) {
        recordingName.value = recordingData.name;
      }
      
      if (recordingData.startTime) {
        const elapsed = Math.floor((Date.now() - recordingData.startTime) / 1000);
        seconds = elapsed;
      }
      
      updateUIToRecording();
      
      micStatus.textContent = 'Capturing audio ✓';
      tabStatus.textContent = 'Capturing audio ✓';
    }
  } catch (error) {
    console.warn('Could not restore recording state:', error.message);
    // This can fail if the background script is not ready, which is fine.
  }
}

// Initial check
restoreRecordingState();
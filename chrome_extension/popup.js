// Popup UI Logic - This is a "dumb" remote control for background.js

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const recordingName = document.getElementById('recordingName');
const recordingStatus = document.getElementById('recordingStatus');
const recordingTime = document.getElementById('recordingTime');
const micStatus = document.getElementById('micStatus');
const tabStatus = document.getElementById('tabStatus');

let recordingInterval;
let seconds = 0;

// Start recording button click
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
  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'startRecording', 
      recordingName: name 
    });
    
    startBtn.disabled = false;
    startBtn.innerHTML = '<span class="icon">⏺️</span> Start Recording';
      
    if (response && response.success) {
      // The background script is now in charge.
      // We just update the UI.
      updateUIToRecording(name, 0);
    } else if (response && response.error) {
      alert('Error starting recording: ' + response.error);
    }
  } catch (error) {
      alert('Error starting recording: ' + error.message);
      startBtn.disabled = false;
      startBtn.innerHTML = '<span class="icon">⏺️</span> Start Recording';
  }
});

// Stop recording button click
stopBtn.addEventListener('click', () => {
  stopBtn.disabled = true;
  stopBtn.textContent = 'Processing...';
  
  // Send message to background to stop
  chrome.runtime.sendMessage(
    { action: 'stopRecording' },
    (response) => {
      stopBtn.disabled = false;
      stopBtn.innerHTML = '<span class="icon">⏹️</span> Finish Recording';
      
      if (response && response.success) {
        updateUIToStopped();
        alert('Recording finished!\nSending to local server for processing...\nYou will get a notification when it is complete.');
      } else if (response && response.error) {
        alert('Error stopping recording: ' + response.error);
      }
    }
  );
});

// --- UI Update Functions ---
// These functions ONLY change the popup's appearance

function updateUIToRecording(name, startTime) {
  recordingName.value = name;
  startBtn.style.display = 'none';
  stopBtn.style.display = 'flex';
  recordingStatus.classList.add('active');
  recordingName.disabled = true;
  micStatus.textContent = 'Capturing audio ✓';
  tabStatus.textContent = 'Capturing audio ✓';
  
  // Calculate elapsed time
  seconds = Math.floor((Date.now() - startTime) / 1000);
  
  // Clear any old interval
  if (recordingInterval) clearInterval(recordingInterval);
  
  // Start new interval to update timer
  recordingInterval = setInterval(() => {
    seconds++;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    recordingTime.textContent = 
      `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, 1000);
}

function updateUIToStopped() {
  if (recordingInterval) clearInterval(recordingInterval);
  startBtn.style.display = 'flex';
  stopBtn.style.display = 'none';
  recordingStatus.classList.remove('active');
  recordingName.disabled = false;
  recordingName.value = ''; // Clear name for next time
  recordingTime.textContent = '00:00';
  micStatus.textContent = 'Ready to capture ✓';
  tabStatus.textContent = 'Ready to capture ✓';
  seconds = 0;
}

// --- Restore State ---
// This is the most important part for fixing the popup bug.
// When the popup opens, it ASKS the background script what the state is.
async function restoreRecordingState() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getRecordingStatus' });
    
    if (response && response.isRecording) {
      // If background says "we are recording", update the UI to match
      const { name, startTime } = response.recordingData || {};
      updateUIToRecording(name, startTime);
    } else {
      // If background says "we are not recording", show the start button
      updateUIToStopped();
    }
  } catch (error) {
    console.warn('Could not restore recording state:', error.message);
    // This can fail if the background script is not ready, which is fine.
    updateUIToStopped();
  }
}

// Initial check when popup opens
document.addEventListener('DOMContentLoaded', restoreRecordingState);
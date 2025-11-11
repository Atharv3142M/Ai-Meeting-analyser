// Popup UI Logic - This is a "dumb" remote control for background.js

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const recordingName = document.getElementById('recordingName');
const recordingStatus = document.getElementById('recordingStatus');
const recordingTime = document.getElementById('recordingTime');
const statusContainer = document.getElementById('statusContainer');
const statusMessage = document.getElementById('statusMessage');

let recordingInterval;
let seconds = 0;

// Start recording button click
startBtn.addEventListener('click', async () => {
  const name = recordingName.value.trim();
  
  if (!name) {
    alert('Please enter a name for the recording.');
    return;
  }

  // Disable button and show status
  startBtn.disabled = true;
  statusMessage.textContent = 'Waiting for permission...';
  statusContainer.style.display = 'block';

  // Send message to background to start
  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'startRecording', 
      recordingName: name 
    });
    
    if (response && response.success) {
      // The background script is now in charge.
      // We just update the UI.
      updateUIToRecording(name, response.startTime);
      // Close the popup window automatically
      window.close();
    } else if (response && response.error) {
      // THIS IS THE FIX for the 'Note: ' bug
      alert('Error starting recording: ' + response.error);
      updateUIToStopped(); // Reset UI
    }
  } catch (error) {
      alert('Error: ' + error.message);
      updateUIToStopped(); // Reset UI
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
function updateUIToRecording(name, startTime) {
  recordingName.value = name;
  startBtn.style.display = 'none';
  stopBtn.style.display = 'flex';
  recordingStatus.classList.add('active');
  recordingName.disabled = true;
  statusContainer.style.display = 'none';
  
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
  startBtn.disabled = false;
  stopBtn.style.display = 'none';
  recordingStatus.classList.remove('active');
  recordingName.disabled = false;
  recordingName.value = ''; // Clear name for next time
  recordingTime.textContent = '00:00';
  statusContainer.style.display = 'none';
  statusMessage.textContent = 'Waiting...';
  seconds = 0;
}

// --- Restore State ---
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
    // This can happen if the background script is not ready (e.g., on extension install)
    console.warn('Could not restore recording state:', error.message);
    updateUIToStopped();
  }
}

// Initial check when popup opens
document.addEventListener('DOMContentLoaded', restoreRecordingState);
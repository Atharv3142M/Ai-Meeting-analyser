/**
 * POAi v2.0 - Popup UI
 * Fixed state management and error handling
 */

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const dashboardBtn = document.getElementById('dashboardBtn');
const recordingName = document.getElementById('recordingName');
const recordingStatus = document.getElementById('recordingStatus');
const recordingTime = document.getElementById('recordingTime');
const divider = document.getElementById('divider');
const errorMessage = document.getElementById('errorMessage');

let recordingInterval;
let seconds = 0;

console.log('[Popup] POAi v2.0 popup loaded');

// ==================== Event Listeners ====================

startBtn.addEventListener('click', async () => {
  const name = recordingName.value.trim();
  
  if (!name) {
    showError('Please enter a name for the recording');
    recordingName.focus();
    return;
  }

  console.log('[Popup] Starting recording:', name);
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';
  hideError();

  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'startRecording', 
      recordingName: name 
    });
    
    if (response && response.success) {
      console.log('[Popup] Recording started successfully');
      updateUIToRecording(name, response.startTime);
      setTimeout(() => window.close(), 800);
    } else {
      console.error('[Popup] Failed to start:', response?.error);
      showError(response?.error || 'Failed to start recording');
      resetStartButton();
    }
  } catch (error) {
    console.error('[Popup] Error:', error);
    showError(error.message || 'Failed to start recording');
    resetStartButton();
  }
});

stopBtn.addEventListener('click', async () => {
  console.log('[Popup] Stop button clicked');
  
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping...';
  hideError();
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });
    
    if (response && response.success) {
      console.log('[Popup] Recording stopped successfully');
      showError('Recording stopped! File will be uploaded shortly. Check the dashboard in a moment.');
      setTimeout(() => {
        updateUIToStopped();
      }, 2000);
    } else {
      console.error('[Popup] Failed to stop:', response?.error);
      showError(response?.error || 'Failed to stop recording');
      stopBtn.disabled = false;
      stopBtn.innerHTML = '<span>⏹️</span> Finish Recording';
    }
  } catch (error) {
    console.error('[Popup] Error:', error);
    showError(error.message || 'Failed to stop recording');
    stopBtn.disabled = false;
    stopBtn.innerHTML = '<span>⏹️</span> Finish Recording';
  }
});

dashboardBtn.addEventListener('click', () => {
  console.log('[Popup] Opening dashboard');
  chrome.tabs.create({ url: 'http://127.0.0.1:5000' });
});

// ==================== UI Functions ====================

function updateUIToRecording(name, startTime) {
  console.log('[Popup] Updating UI to recording state');
  
  recordingName.value = name;
  recordingName.disabled = true;
  
  startBtn.style.display = 'none';
  stopBtn.style.display = 'flex';
  stopBtn.disabled = false;
  dashboardBtn.style.display = 'none';
  divider.style.display = 'none';
  
  recordingStatus.classList.add('active');
  
  seconds = Math.floor((Date.now() - startTime) / 1000);
  updateTimer();
  
  if (recordingInterval) {
    clearInterval(recordingInterval);
  }
  
  recordingInterval = setInterval(() => {
    seconds++;
    updateTimer();
  }, 1000);
}

function updateUIToStopped() {
  console.log('[Popup] Updating UI to stopped state');
  
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }
  
  recordingName.disabled = false;
  recordingName.value = '';
  recordingName.focus();
  
  startBtn.style.display = 'flex';
  startBtn.disabled = false;
  startBtn.innerHTML = '<span>▶️</span> Start Recording';
  
  stopBtn.style.display = 'none';
  stopBtn.innerHTML = '<span>⏹️</span> Finish Recording';
  
  dashboardBtn.style.display = 'flex';
  divider.style.display = 'block';
  
  recordingStatus.classList.remove('active');
  recordingTime.textContent = '00:00';
  
  seconds = 0;
}

function resetStartButton() {
  startBtn.disabled = false;
  startBtn.innerHTML = '<span>▶️</span> Start Recording';
}

function updateTimer() {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  recordingTime.textContent = 
    `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}

function hideError() {
  errorMessage.classList.remove('show');
}

// ==================== State Restoration ====================

async function restoreRecordingState() {
  console.log('[Popup] Restoring state...');
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getRecordingStatus' });
    
    console.log('[Popup] State response:', response);
    
    if (response && response.isRecording) {
      console.log('[Popup] Recording in progress, showing recording UI');
      const { name, startTime } = response.recordingData || {};
      
      if (name && startTime) {
        updateUIToRecording(name, startTime);
      } else {
        console.warn('[Popup] Invalid recording data, resetting UI');
        updateUIToStopped();
      }
    } else {
      console.log('[Popup] No active recording, showing start UI');
      updateUIToStopped();
    }
  } catch (error) {
    console.warn('[Popup] Could not restore state:', error);
    updateUIToStopped();
  }
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOM loaded, restoring state');
  restoreRecordingState();
  
  if (!recordingName.disabled) {
    recordingName.focus();
  }
});
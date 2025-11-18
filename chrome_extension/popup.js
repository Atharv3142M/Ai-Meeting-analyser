/**
 * POAi v2.0 - Popup UI
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

console.log('[Popup] Loaded');

startBtn.addEventListener('click', async () => {
  const name = recordingName.value.trim();
  
  if (!name) {
    showError('Please enter a recording name');
    recordingName.focus();
    return;
  }

  console.log('[Popup] Starting:', name);
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';
  hideError();

  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'startRecording', 
      recordingName: name 
    });
    
    if (response && response.success) {
      console.log('[Popup] Started successfully');
      updateUIToRecording(name, response.startTime);
      setTimeout(() => window.close(), 800);
    } else {
      console.error('[Popup] Failed:', response?.error);
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
  console.log('[Popup] Stop clicked');
  
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping...';
  hideError();
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });
    
    if (response && response.success) {
      console.log('[Popup] Stopped successfully');
      showError('Recording stopped! Uploading to server...');
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
  chrome.tabs.create({ url: 'http://127.0.0.1:5000' });
});

function updateUIToRecording(name, startTime) {
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
  
  if (recordingInterval) clearInterval(recordingInterval);
  
  recordingInterval = setInterval(() => {
    seconds++;
    updateTimer();
  }, 1000);
}

function updateUIToStopped() {
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

async function restoreRecordingState() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getRecordingStatus' });
    
    if (response && response.isRecording) {
      const { name, startTime } = response.recordingData || {};
      
      if (name && startTime) {
        updateUIToRecording(name, startTime);
      } else {
        updateUIToStopped();
      }
    } else {
      updateUIToStopped();
    }
  } catch (error) {
    console.warn('[Popup] Could not restore state:', error);
    updateUIToStopped();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  restoreRecordingState();
  
  if (!recordingName.disabled) {
    recordingName.focus();
  }
});
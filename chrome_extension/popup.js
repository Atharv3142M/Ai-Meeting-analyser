/**
 * POAi v2.0 - Popup UI Controller
 * Handles user interactions and state display
 */

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const dashboardBtn = document.getElementById('dashboardBtn');
const recordingName = document.getElementById('recordingName');
const recordingStatus = document.getElementById('recordingStatus');
const recordingTime = document.getElementById('recordingTime');
const divider = document.getElementById('divider');
const errorMessage = document.getElementById('errorMessage');

let recordingInterval = null;
let seconds = 0;

console.log('[Popup] POAi v2.0 popup loaded');

// ==================== Event Listeners ====================

startBtn.addEventListener('click', async () => {
  const name = recordingName.value.trim();
  
  if (!name) {
    showError('Please enter a recording name');
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
      console.log('[Popup] ✓ Recording started successfully');
      updateUIToRecording(name, response.startTime);
      
      // Close popup after short delay (optional - keeps it open for testing)
      // setTimeout(() => window.close(), 1000);
    } else {
      const errorMsg = response?.error || 'Failed to start recording';
      console.error('[Popup] Start failed:', errorMsg);
      showError(errorMsg);
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
    const response = await chrome.runtime.sendMessage({ 
      action: 'stopRecording' 
    });
    
    if (response && response.success) {
      console.log('[Popup] ✓ Recording stopped successfully');
      showError('✓ Recording stopped! Uploading to server...');
      
      // Reset UI after brief delay
      setTimeout(() => {
        updateUIToStopped();
      }, 2000);
    } else {
      const errorMsg = response?.error || 'Failed to stop recording';
      console.error('[Popup] Stop failed:', errorMsg);
      showError(errorMsg);
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

// ==================== UI State Management ====================

function updateUIToRecording(name, startTime) {
  console.log('[Popup] Updating UI to recording state');
  
  // Update form
  recordingName.value = name;
  recordingName.disabled = true;
  
  // Show/hide buttons
  startBtn.style.display = 'none';
  stopBtn.style.display = 'flex';
  stopBtn.disabled = false;
  stopBtn.innerHTML = '<span>⏹️</span> Finish Recording';
  dashboardBtn.style.display = 'none';
  divider.style.display = 'none';
  
  // Show recording status
  recordingStatus.classList.add('active');
  
  // Start timer
  seconds = Math.floor((Date.now() - startTime) / 1000);
  updateTimer();
  
  // Clear any existing interval
  if (recordingInterval) {
    clearInterval(recordingInterval);
  }
  
  // Start new interval
  recordingInterval = setInterval(() => {
    seconds++;
    updateTimer();
  }, 1000);
}

function updateUIToStopped() {
  console.log('[Popup] Updating UI to stopped state');
  
  // Stop timer
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }
  
  // Reset form
  recordingName.disabled = false;
  recordingName.value = '';
  recordingName.focus();
  
  // Show/hide buttons
  startBtn.style.display = 'flex';
  startBtn.disabled = false;
  startBtn.innerHTML = '<span>▶️</span> Start Recording';
  
  stopBtn.style.display = 'none';
  stopBtn.innerHTML = '<span>⏹️</span> Finish Recording';
  
  dashboardBtn.style.display = 'flex';
  divider.style.display = 'block';
  
  // Hide recording status
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

// ==================== Error Display ====================

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}

function hideError() {
  errorMessage.classList.remove('show');
}

// ==================== State Restoration ====================

async function restoreRecordingState() {
  console.log('[Popup] Restoring recording state from background...');
  
  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'getRecordingStatus' 
    });
    
    console.log('[Popup] State response:', response);
    
    if (response && response.isRecording) {
      console.log('[Popup] Active recording detected');
      const { name, startTime } = response.recordingData || {};
      
      if (name && startTime) {
        updateUIToRecording(name, startTime);
      } else {
        console.warn('[Popup] Invalid recording data, resetting UI');
        updateUIToStopped();
      }
    } else {
      console.log('[Popup] No active recording');
      updateUIToStopped();
    }
  } catch (error) {
    console.warn('[Popup] Could not restore state:', error);
    updateUIToStopped();
  }
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOM loaded, initializing...');
  
  // Restore state from background
  restoreRecordingState();
  
  // Focus name input if not recording
  if (!recordingName.disabled) {
    recordingName.focus();
  }
  
  console.log('[Popup] Initialization complete');
});
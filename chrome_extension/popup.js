/**
 * POAi v2.0 - Popup UI Logic
 * Handles user interactions and communicates with background script
 */

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const dashboardBtn = document.getElementById('dashboardBtn');
const recordingName = document.getElementById('recordingName');
const recordingStatus = document.getElementById('recordingStatus');
const recordingTime = document.getElementById('recordingTime');

let recordingInterval;
let seconds = 0;

// ==================== Event Listeners ====================

// Start Recording Button
startBtn.addEventListener('click', async () => {
  const name = recordingName.value.trim();
  
  if (!name) {
    showNotification('Please enter a name for the recording', 'warning');
    recordingName.focus();
    return;
  }

  console.log('[Popup] Starting recording:', name);
  
  // Disable button
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';

  try {
    // Send message to background script
    const response = await chrome.runtime.sendMessage({ 
      action: 'startRecording', 
      recordingName: name 
    });
    
    if (response && response.success) {
      console.log('[Popup] Recording started successfully');
      updateUIToRecording(name, response.startTime);
      
      // Close popup after short delay
      setTimeout(() => window.close(), 800);
    } else {
      console.error('[Popup] Failed to start recording:', response?.error);
      showNotification(response?.error || 'Failed to start recording', 'error');
      resetStartButton();
    }
  } catch (error) {
    console.error('[Popup] Error starting recording:', error);
    showNotification('Error: ' + error.message, 'error');
    resetStartButton();
  }
});

// Stop Recording Button
stopBtn.addEventListener('click', async () => {
  console.log('[Popup] Stop button clicked');
  
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping...';
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });
    
    if (response && response.success) {
      console.log('[Popup] Recording stopped successfully');
      showNotification('Recording stopped. Processing...', 'success');
      updateUIToStopped();
    } else {
      console.error('[Popup] Failed to stop recording:', response?.error);
      showNotification(response?.error || 'Failed to stop recording', 'error');
      stopBtn.disabled = false;
      stopBtn.innerHTML = '<span class="icon">⏹️</span> Finish Recording';
    }
  } catch (error) {
    console.error('[Popup] Error stopping recording:', error);
    showNotification('Error: ' + error.message, 'error');
    stopBtn.disabled = false;
    stopBtn.innerHTML = '<span class="icon">⏹️</span> Finish Recording';
  }
});

// Open Dashboard Button
dashboardBtn.addEventListener('click', () => {
  console.log('[Popup] Opening dashboard');
  chrome.tabs.create({ url: 'http://127.0.0.1:5000' });
});

// ==================== UI Update Functions ====================

function updateUIToRecording(name, startTime) {
  console.log('[Popup] Updating UI to recording state');
  
  // Update input
  recordingName.value = name;
  recordingName.disabled = true;
  
  // Update buttons
  startBtn.style.display = 'none';
  stopBtn.style.display = 'flex';
  stopBtn.disabled = false;
  
  // Show status
  recordingStatus.classList.add('active');
  
  // Calculate elapsed time
  seconds = Math.floor((Date.now() - startTime) / 1000);
  updateTimer();
  
  // Clear any existing interval
  if (recordingInterval) {
    clearInterval(recordingInterval);
  }
  
  // Start timer
  recordingInterval = setInterval(() => {
    seconds++;
    updateTimer();
  }, 1000);
}

function updateUIToStopped() {
  console.log('[Popup] Updating UI to stopped state');
  
  // Clear timer
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }
  
  // Reset input
  recordingName.disabled = false;
  recordingName.value = '';
  recordingName.focus();
  
  // Reset buttons
  startBtn.style.display = 'flex';
  startBtn.disabled = false;
  startBtn.innerHTML = '<span class="icon">▶️</span> Start Recording';
  
  stopBtn.style.display = 'none';
  stopBtn.innerHTML = '<span class="icon">⏹️</span> Finish Recording';
  
  // Hide status
  recordingStatus.classList.remove('active');
  recordingTime.textContent = '00:00';
  
  // Reset timer
  seconds = 0;
}

function resetStartButton() {
  startBtn.disabled = false;
  startBtn.innerHTML = '<span class="icon">▶️</span> Start Recording';
}

function updateTimer() {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  recordingTime.textContent = 
    `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function showNotification(message, type = 'info') {
  // Simple alert for now - could be enhanced with custom notification UI
  console.log(`[Popup] ${type.toUpperCase()}: ${message}`);
  alert(message);
}

// ==================== State Restoration ====================

async function restoreRecordingState() {
  console.log('[Popup] Restoring recording state...');
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getRecordingStatus' });
    
    if (response && response.isRecording) {
      console.log('[Popup] Recording in progress, updating UI');
      const { name, startTime } = response.recordingData || {};
      updateUIToRecording(name, startTime);
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
  console.log('[Popup] POAi v2.0 popup loaded');
  restoreRecordingState();
  
  // Focus on input field
  if (!recordingName.disabled) {
    recordingName.focus();
  }
});
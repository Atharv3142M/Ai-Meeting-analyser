// POAi v2.0 - Popup Script
console.log('[Popup] Initializing...');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const dashboardBtn = document.getElementById('dashboardBtn');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const timerDisplay = document.getElementById('timer');
const errorDiv = document.getElementById('error');

let timerInterval = null;

// Update UI based on recording state
async function updateUI() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getState' });
        const { isRecording, startTime } = response || {};
        
        if (isRecording) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusText.textContent = 'Recording...';
            statusDot.classList.remove('inactive');
            
            // Start timer
            if (!timerInterval && startTime) {
                timerInterval = setInterval(() => {
                    const elapsed = Math.floor((Date.now() - startTime) / 1000);
                    const mins = Math.floor(elapsed / 60);
                    const secs = elapsed % 60;
                    timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                }, 1000);
            }
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
            statusText.textContent = 'Ready';
            statusDot.classList.add('inactive');
            timerDisplay.textContent = '00:00';
            
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
        }
    } catch (error) {
        console.error('[Popup] Error updating UI:', error);
    }
}

// Show error message
function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

// Start recording
startBtn.addEventListener('click', async () => {
    try {
        console.log('[Popup] Start button clicked');
        errorDiv.style.display = 'none';
        
        const response = await chrome.runtime.sendMessage({ action: 'startRecording' });
        
        if (response && response.success) {
            console.log('[Popup] Recording started successfully');
            await updateUI();
        } else {
            const errorMsg = response?.error || 'Failed to start recording';
            console.error('[Popup] Start failed:', errorMsg);
            showError(errorMsg);
        }
    } catch (error) {
        console.error('[Popup] Error starting recording:', error);
        showError('Error: ' + error.message);
    }
});

// Stop recording
stopBtn.addEventListener('click', async () => {
    try {
        console.log('[Popup] Stop button clicked');
        
        const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });
        
        if (response && response.success) {
            console.log('[Popup] Recording stopped successfully');
            await updateUI();
        } else {
            const errorMsg = response?.error || 'Failed to stop recording';
            console.error('[Popup] Stop failed:', errorMsg);
            showError(errorMsg);
        }
    } catch (error) {
        console.error('[Popup] Error stopping recording:', error);
        showError('Error: ' + error.message);
    }
});

// Open dashboard
dashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://127.0.0.1:5000' });
});

// Initialize UI on popup open
updateUI();

// Update UI every second while popup is open
setInterval(updateUI, 1000);
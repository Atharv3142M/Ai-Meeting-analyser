// POAi v2.0 - Background Service Worker
// Handles recording coordination, offscreen document management, and upload

console.log('[Background] Service worker initialized');

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const SERVER_URL = 'http://127.0.0.1:5000';

// Recording state
let recordingState = {
    isRecording: false,
    startTime: null,
    streamId: null,
    recordedChunks: []
};

// ==================== Offscreen Document Management ====================

async function hasOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return contexts.length > 0;
}

async function createOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        console.log('[Background] Offscreen document already exists');
        return;
    }
    
    try {
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: ['USER_MEDIA'],
            justification: 'Recording screen and audio for meeting transcription'
        });
        console.log('[Background] Offscreen document created');
    } catch (error) {
        console.error('[Background] Error creating offscreen document:', error);
        throw error;
    }
}

async function closeOffscreenDocument() {
    if (!(await hasOffscreenDocument())) {
        return;
    }
    
    try {
        await chrome.offscreen.closeDocument();
        console.log('[Background] Offscreen document closed');
    } catch (error) {
        console.error('[Background] Error closing offscreen document:', error);
    }
}

// ==================== Recording Control ====================

async function startRecording() {
    try {
        console.log('[Background] Starting recording...');
        
        if (recordingState.isRecording) {
            throw new Error('Recording already in progress');
        }
        
        // Step 1: Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            throw new Error('No active tab found');
        }
        
        console.log('[Background] Active tab:', tab.title);
        
        // Step 2: Request screen capture with audio
        // CRITICAL: Request all sources including 'audio' to enable "Share system audio" checkbox
        const streamId = await new Promise((resolve, reject) => {
            chrome.desktopCapture.chooseDesktopMedia(
                ['screen', 'window', 'tab', 'audio'], // Include 'audio' to show audio option
                tab,
                (streamId, options) => {
                    console.log('[Background] DesktopCapture result:', { streamId, options });
                    
                    if (!streamId) {
                        // User cancelled or error occurred
                        reject(new Error('Screen capture cancelled by user'));
                        return;
                    }
                    
                    resolve(streamId);
                }
            );
        });
        
        console.log('[Background] Got stream ID:', streamId);
        
        // Step 3: Create offscreen document
        await createOffscreenDocument();
        
        // Wait for offscreen document to be ready
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 4: Send stream ID to offscreen document
        const response = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'start-recording',
            streamId: streamId
        });
        
        if (!response || !response.success) {
            throw new Error(response?.error || 'Offscreen recording failed to start');
        }
        
        // Step 5: Update state
        recordingState.isRecording = true;
        recordingState.startTime = Date.now();
        recordingState.streamId = streamId;
        recordingState.recordedChunks = [];
        
        console.log('[Background] Recording started successfully');
        return { success: true };
        
    } catch (error) {
        console.error('[Background] Error starting recording:', error);
        
        // Clean up on error
        await closeOffscreenDocument();
        recordingState.isRecording = false;
        recordingState.startTime = null;
        recordingState.streamId = null;
        
        return { success: false, error: error.message };
    }
}

async function stopRecording() {
    try {
        console.log('[Background] Stopping recording...');
        
        if (!recordingState.isRecording) {
            throw new Error('No recording in progress');
        }
        
        // Step 1: Tell offscreen document to stop
        const response = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'stop-recording'
        });
        
        if (!response || !response.success) {
            console.warn('[Background] Offscreen stop warning:', response?.error);
        }
        
        // Step 2: Get recorded data (will come via message)
        // Wait briefly for data message
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Step 3: Upload if we have data
        if (recordingState.recordedChunks.length > 0) {
            console.log('[Background] Uploading recording...');
            await uploadRecording(recordingState.recordedChunks);
        } else {
            console.warn('[Background] No recorded data to upload');
        }
        
        // Step 4: Clean up
        await closeOffscreenDocument();
        
        recordingState.isRecording = false;
        recordingState.startTime = null;
        recordingState.streamId = null;
        recordingState.recordedChunks = [];
        
        console.log('[Background] Recording stopped successfully');
        return { success: true };
        
    } catch (error) {
        console.error('[Background] Error stopping recording:', error);
        
        // Force cleanup
        await closeOffscreenDocument();
        recordingState.isRecording = false;
        
        return { success: false, error: error.message };
    }
}

// ==================== Upload to Server ====================

async function uploadRecording(chunks) {
    try {
        console.log('[Background] Preparing upload...', {
            chunks: chunks.length,
            totalSize: chunks.reduce((sum, chunk) => sum + chunk.size, 0)
        });
        
        // Create blob from chunks
        const blob = new Blob(chunks, { type: 'video/webm;codecs=vp9,opus' });
        console.log('[Background] Blob created:', {
            size: blob.size,
            type: blob.type
        });
        
        if (blob.size === 0) {
            throw new Error('Recording is empty (0 bytes)');
        }
        
        // Create form data
        const formData = new FormData();
        const filename = `recording_${Date.now()}.webm`;
        formData.append('video', blob, filename);
        formData.append('title', `Meeting ${new Date().toLocaleString()}`);
        
        console.log('[Background] Uploading to server...');
        
        // Upload to server
        const response = await fetch(`${SERVER_URL}/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Upload failed: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        console.log('[Background] Upload successful:', result);
        
        // Show notification
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'POAi Recording Complete',
            message: 'Your recording is being processed. Check the dashboard for results.',
            priority: 2
        });
        
        return { success: true, result };
        
    } catch (error) {
        console.error('[Background] Upload error:', error);
        
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'POAi Upload Failed',
            message: error.message,
            priority: 2
        });
        
        throw error;
    }
}

// ==================== Message Handling ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Message received:', message);
    
    // Handle messages from popup
    if (message.action === 'startRecording') {
        startRecording()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
    
    if (message.action === 'stopRecording') {
        stopRecording()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    if (message.action === 'getState') {
        sendResponse({
            isRecording: recordingState.isRecording,
            startTime: recordingState.startTime
        });
        return false;
    }
    
    // Handle messages from offscreen document
    if (message.target === 'background') {
        if (message.action === 'recording-data') {
            // Store chunks from offscreen
            if (message.data && message.data.length > 0) {
                recordingState.recordedChunks = message.data;
                console.log('[Background] Received recording data:', message.data.length, 'chunks');
            }
            sendResponse({ success: true });
            return false;
        }
        
        if (message.action === 'recording-error') {
            console.error('[Background] Recording error from offscreen:', message.error);
            recordingState.isRecording = false;
            sendResponse({ success: true });
            return false;
        }
    }
    
    return false;
});

// ==================== Extension Lifecycle ====================

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Background] Extension installed/updated');
});

chrome.runtime.onSuspend.addListener(() => {
    console.log('[Background] Service worker suspending...');
    if (recordingState.isRecording) {
        console.warn('[Background] Recording interrupted by suspension');
    }
});

console.log('[Background] Service worker ready');
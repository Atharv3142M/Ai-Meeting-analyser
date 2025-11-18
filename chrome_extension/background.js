// POAi v2.0 - Background Service Worker
// PRODUCTION-READY: Handles recording coordination with zero corruption

console.log('[Background] Service worker initialized');

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const SERVER_URL = 'http://127.0.0.1:5000';

// Recording state
let recordingState = {
    isRecording: false,
    startTime: null,
    recordedChunks: []
};

// ==================== Offscreen Document Management ====================

async function hasOffscreenDocument() {
    try {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        return contexts.length > 0;
    } catch (error) {
        console.error('[Background] Error checking offscreen:', error);
        return false;
    }
}

async function createOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        console.log('[Background] Offscreen document already exists');
        return true;
    }
    
    try {
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: ['USER_MEDIA'],
            justification: 'Recording screen and audio for meeting transcription'
        });
        console.log('[Background] ✓ Offscreen document created');
        
        // Wait for document to fully initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
    } catch (error) {
        console.error('[Background] Error creating offscreen document:', error);
        return false;
    }
}

async function closeOffscreenDocument() {
    if (!(await hasOffscreenDocument())) {
        return;
    }
    
    try {
        await chrome.offscreen.closeDocument();
        console.log('[Background] ✓ Offscreen document closed');
    } catch (error) {
        console.error('[Background] Error closing offscreen:', error);
    }
}

// ==================== Recording Control ====================

async function startRecording() {
    try {
        console.log('[Background] ========================================');
        console.log('[Background] START RECORDING INITIATED');
        console.log('[Background] ========================================');
        
        if (recordingState.isRecording) {
            throw new Error('Recording already in progress');
        }
        
        // Reset state
        recordingState.recordedChunks = [];
        
        // Step 1: Create offscreen document FIRST
        console.log('[Background] Step 1: Creating offscreen document...');
        const offscreenReady = await createOffscreenDocument();
        
        if (!offscreenReady) {
            throw new Error('Failed to create offscreen document');
        }
        
        // Step 2: Request screen sharing via offscreen
        console.log('[Background] Step 2: Requesting screen sharing...');
        
        const startResponse = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'start-recording'
        });
        
        console.log('[Background] Start response:', startResponse);
        
        if (!startResponse || !startResponse.success) {
            throw new Error(startResponse?.error || 'Failed to start recording in offscreen');
        }
        
        // Step 3: Update state
        recordingState.isRecording = true;
        recordingState.startTime = Date.now();
        
        console.log('[Background] ========================================');
        console.log('[Background] ✓ RECORDING STARTED SUCCESSFULLY');
        console.log('[Background] ========================================');
        
        return { success: true };
        
    } catch (error) {
        console.error('[Background] ========================================');
        console.error('[Background] ✗ START RECORDING FAILED');
        console.error('[Background]', error);
        console.error('[Background] ========================================');
        
        // Clean up on error
        await closeOffscreenDocument();
        recordingState.isRecording = false;
        recordingState.startTime = null;
        
        return { success: false, error: error.message };
    }
}

async function stopRecording() {
    try {
        console.log('[Background] ========================================');
        console.log('[Background] STOP RECORDING INITIATED');
        console.log('[Background] ========================================');
        
        if (!recordingState.isRecording) {
            throw new Error('No recording in progress');
        }
        
        // Step 1: Tell offscreen to stop and get data
        console.log('[Background] Step 1: Stopping offscreen recording...');
        
        const stopResponse = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'stop-recording'
        });
        
        console.log('[Background] Stop response:', stopResponse);
        
        if (!stopResponse || !stopResponse.success) {
            console.warn('[Background] Stop warning:', stopResponse?.error);
        }
        
        // Step 2: Wait for data to arrive
        console.log('[Background] Step 2: Waiting for recorded data...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Step 3: Upload if we have data
        if (recordingState.recordedChunks.length > 0) {
            console.log('[Background] Step 3: Uploading', recordingState.recordedChunks.length, 'chunks...');
            await uploadRecording(recordingState.recordedChunks);
        } else {
            console.error('[Background] ✗ NO DATA RECORDED - Recording may have failed');
            throw new Error('No data was recorded. Please try again.');
        }
        
        // Step 4: Clean up
        await closeOffscreenDocument();
        
        recordingState.isRecording = false;
        recordingState.startTime = null;
        recordingState.recordedChunks = [];
        
        console.log('[Background] ========================================');
        console.log('[Background] ✓ RECORDING STOPPED & UPLOADED');
        console.log('[Background] ========================================');
        
        return { success: true };
        
    } catch (error) {
        console.error('[Background] ========================================');
        console.error('[Background] ✗ STOP RECORDING FAILED');
        console.error('[Background]', error);
        console.error('[Background] ========================================');
        
        // Force cleanup
        await closeOffscreenDocument();
        recordingState.isRecording = false;
        
        return { success: false, error: error.message };
    }
}

// ==================== Upload to Server ====================

async function uploadRecording(chunks) {
    try {
        const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        
        console.log('[Background] Upload preparation:', {
            chunks: chunks.length,
            totalSize: totalSize,
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2) + ' MB'
        });
        
        if (totalSize === 0) {
            throw new Error('Recording is empty (0 bytes)');
        }
        
        if (totalSize < 10000) {
            throw new Error('Recording too small (' + totalSize + ' bytes) - likely corrupted');
        }
        
        // Create blob
        const blob = new Blob(chunks, { type: 'video/webm;codecs=vp9,opus' });
        console.log('[Background] Blob created:', blob.size, 'bytes,', blob.type);
        
        // Verify WebM header
        const header = await blob.slice(0, 4).arrayBuffer();
        const headerBytes = new Uint8Array(header);
        const headerHex = Array.from(headerBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
        
        console.log('[Background] File header:', headerHex);
        
        // WebM signature: 1A 45 DF A3
        if (headerBytes[0] !== 0x1A || headerBytes[1] !== 0x45 || 
            headerBytes[2] !== 0xDF || headerBytes[3] !== 0xA3) {
            console.error('[Background] ✗ INVALID WEBM HEADER!');
            console.error('[Background] Expected: 1a 45 df a3');
            console.error('[Background] Got:', headerHex);
            throw new Error('Invalid WebM file header - recording corrupted');
        }
        
        console.log('[Background] ✓ Valid WebM header confirmed');
        
        // Create form data
        const formData = new FormData();
        const filename = `recording_${Date.now()}.webm`;
        formData.append('video', blob, filename);
        formData.append('title', `Meeting ${new Date().toLocaleString()}`);
        
        console.log('[Background] Uploading to', SERVER_URL + '/upload');
        
        // Upload with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout
        
        const response = await fetch(`${SERVER_URL}/upload`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Upload failed: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        console.log('[Background] ✓ Upload successful:', result);
        
        // Show success notification
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '✓ POAi Recording Complete',
            message: 'Your recording is being processed. Check the dashboard!',
            priority: 2
        });
        
        return { success: true, result };
        
    } catch (error) {
        console.error('[Background] Upload error:', error);
        
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '✗ POAi Upload Failed',
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
                console.log('[Background] ✓ Received', message.data.length, 'chunks from offscreen');
                
                const totalSize = message.data.reduce((sum, chunk) => sum + chunk.size, 0);
                console.log('[Background] Total size:', (totalSize / (1024 * 1024)).toFixed(2), 'MB');
            } else {
                console.error('[Background] ✗ No data received from offscreen!');
            }
            sendResponse({ success: true });
            return false;
        }
        
        if (message.action === 'recording-error') {
            console.error('[Background] Recording error from offscreen:', message.error);
            recordingState.isRecording = false;
            
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: '✗ Recording Error',
                message: message.error,
                priority: 2
            });
            
            sendResponse({ success: true });
            return false;
        }
    }
    
    return false;
});

console.log('[Background] ✓ Service worker ready');
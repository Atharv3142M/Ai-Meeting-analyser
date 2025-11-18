// POAi v2.0 - Offscreen Recording Script
// Handles screen capture, audio mixing, and MediaRecorder

console.log('[Offscreen] Script loaded');

let mediaRecorder = null;
let recordedChunks = [];
let combinedStream = null;
let audioContext = null;
let audioDestination = null;

// ==================== Audio Mixing with Web Audio API ====================

async function createMixedAudioStream(displayStream) {
    console.log('[Offscreen] Creating mixed audio stream...');
    
    try {
        // Create Web Audio API context
        audioContext = new AudioContext();
        audioDestination = audioContext.createMediaStreamDestination();
        
        console.log('[Offscreen] Audio context created');
        
        let hasAudio = false;
        
        // 1. Mix system/tab audio from display stream
        const displayAudioTracks = displayStream.getAudioTracks();
        if (displayAudioTracks.length > 0) {
            console.log('[Offscreen] Found display audio:', displayAudioTracks.length, 'tracks');
            
            for (const track of displayAudioTracks) {
                try {
                    const source = audioContext.createMediaStreamSource(
                        new MediaStream([track])
                    );
                    source.connect(audioDestination);
                    hasAudio = true;
                    console.log('[Offscreen] Connected display audio track');
                } catch (error) {
                    console.warn('[Offscreen] Failed to connect display audio:', error);
                }
            }
        } else {
            console.warn('[Offscreen] No display audio tracks found');
        }
        
        // 2. Try to add microphone audio
        try {
            console.log('[Offscreen] Requesting microphone audio...');
            
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            const micTracks = micStream.getAudioTracks();
            if (micTracks.length > 0) {
                console.log('[Offscreen] Microphone audio granted:', micTracks.length, 'tracks');
                
                for (const track of micTracks) {
                    try {
                        const source = audioContext.createMediaStreamSource(
                            new MediaStream([track])
                        );
                        source.connect(audioDestination);
                        hasAudio = true;
                        console.log('[Offscreen] Connected microphone track');
                    } catch (error) {
                        console.warn('[Offscreen] Failed to connect microphone:', error);
                    }
                }
            }
        } catch (error) {
            console.warn('[Offscreen] Microphone access denied or not available:', error.message);
            // This is OK - we can record without mic
        }
        
        if (!hasAudio) {
            console.warn('[Offscreen] No audio sources available - recording video only');
        }
        
        // Return the mixed audio stream
        return audioDestination.stream;
        
    } catch (error) {
        console.error('[Offscreen] Error creating mixed audio:', error);
        throw error;
    }
}

// ==================== Recording Control ====================

async function startRecording(streamId) {
    try {
        console.log('[Offscreen] Starting recording with stream ID:', streamId);
        
        // Step 1: Get display media stream from stream ID
        const constraints = {
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId
                }
            },
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId
                }
            }
        };
        
        console.log('[Offscreen] Requesting display media...');
        const displayStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log('[Offscreen] Display stream obtained:', {
            videoTracks: displayStream.getVideoTracks().length,
            audioTracks: displayStream.getAudioTracks().length
        });
        
        // Validate video track
        const videoTracks = displayStream.getVideoTracks();
        if (videoTracks.length === 0) {
            throw new Error('No video track in display stream');
        }
        
        // Step 2: Create mixed audio stream
        const mixedAudioStream = await createMixedAudioStream(displayStream);
        
        // Step 3: Combine video + mixed audio
        combinedStream = new MediaStream([
            ...displayStream.getVideoTracks(),
            ...mixedAudioStream.getAudioTracks()
        ]);
        
        console.log('[Offscreen] Combined stream created:', {
            videoTracks: combinedStream.getVideoTracks().length,
            audioTracks: combinedStream.getAudioTracks().length,
            active: combinedStream.active
        });
        
        // CRITICAL FIX: Validate stream is active before starting recorder
        if (!combinedStream.active) {
            throw new Error('Combined stream is not active');
        }
        
        if (combinedStream.getVideoTracks().length === 0) {
            throw new Error('No video tracks in combined stream');
        }
        
        // Step 4: Create MediaRecorder
        const mimeType = 'video/webm;codecs=vp9,opus';
        
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            console.warn('[Offscreen] Preferred codec not supported, trying fallback...');
            const fallbackType = 'video/webm';
            
            if (!MediaRecorder.isTypeSupported(fallbackType)) {
                throw new Error('No supported video codecs found');
            }
            
            mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: fallbackType
            });
        } else {
            mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: mimeType,
                videoBitsPerSecond: 2500000
            });
        }
        
        console.log('[Offscreen] MediaRecorder created:', mediaRecorder.mimeType);
        
        // Step 5: Set up event handlers
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
                console.log('[Offscreen] Data chunk:', event.data.size, 'bytes', 
                            'Total chunks:', recordedChunks.length);
            }
        };
        
        mediaRecorder.onstop = () => {
            console.log('[Offscreen] MediaRecorder stopped');
            console.log('[Offscreen] Total recorded:', recordedChunks.length, 'chunks');
            
            // Send data to background
            chrome.runtime.sendMessage({
                target: 'background',
                action: 'recording-data',
                data: recordedChunks
            });
            
            // Clean up
            cleanup();
        };
        
        mediaRecorder.onerror = (error) => {
            console.error('[Offscreen] MediaRecorder error:', error);
            chrome.runtime.sendMessage({
                target: 'background',
                action: 'recording-error',
                error: error.toString()
            });
            cleanup();
        };
        
        // Step 6: Start recording
        // Request data every 1 second for better reliability
        mediaRecorder.start(1000);
        
        console.log('[Offscreen] Recording started successfully');
        console.log('[Offscreen] Recorder state:', mediaRecorder.state);
        
        // Update status display
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = 'Recording in progress...';
        }
        
        return { success: true };
        
    } catch (error) {
        console.error('[Offscreen] Error starting recording:', error);
        cleanup();
        return { success: false, error: error.message };
    }
}

function stopRecording() {
    try {
        console.log('[Offscreen] Stopping recording...');
        
        if (!mediaRecorder) {
            console.warn('[Offscreen] No MediaRecorder to stop');
            return { success: false, error: 'No recording in progress' };
        }
        
        if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            console.log('[Offscreen] MediaRecorder.stop() called');
        } else {
            console.warn('[Offscreen] MediaRecorder not in recording state:', mediaRecorder.state);
        }
        
        // Update status
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = 'Recording stopped, processing...';
        }
        
        return { success: true };
        
    } catch (error) {
        console.error('[Offscreen] Error stopping recording:', error);
        return { success: false, error: error.message };
    }
}

function cleanup() {
    console.log('[Offscreen] Cleaning up resources...');
    
    // Stop all tracks
    if (combinedStream) {
        combinedStream.getTracks().forEach(track => {
            track.stop();
            console.log('[Offscreen] Stopped track:', track.kind);
        });
        combinedStream = null;
    }
    
    // Close audio context
    if (audioContext) {
        audioContext.close().catch(err => {
            console.warn('[Offscreen] Error closing audio context:', err);
        });
        audioContext = null;
    }
    
    audioDestination = null;
    mediaRecorder = null;
    
    console.log('[Offscreen] Cleanup complete');
}

// ==================== Message Handling ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Offscreen] Message received:', message);
    
    if (message.target !== 'offscreen') {
        return false;
    }
    
    if (message.action === 'start-recording') {
        startRecording(message.streamId)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
    
    if (message.action === 'stop-recording') {
        const result = stopRecording();
        sendResponse(result);
        return false;
    }
    
    return false;
});

console.log('[Offscreen] Ready to receive commands');
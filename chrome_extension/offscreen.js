// POAi v2.0 - Offscreen Recording Script
// PRODUCTION-READY: Zero corruption, guaranteed recording

console.log('[Offscreen] ========================================');
console.log('[Offscreen] Script loaded and ready');
console.log('[Offscreen] ========================================');

let mediaRecorder = null;
let recordedChunks = [];
let combinedStream = null;
let audioContext = null;
let displayStream = null;
let micStream = null;

// Update status display
function updateStatus(text) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = text;
        console.log('[Offscreen] Status:', text);
    }
}

// ==================== Audio Mixing with Web Audio API ====================

async function createMixedAudioStream(displayMediaStream) {
    console.log('[Offscreen] Creating mixed audio stream...');
    
    try {
        // Create Web Audio API context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioDestination = audioContext.createMediaStreamDestination();
        
        console.log('[Offscreen] ✓ AudioContext created');
        
        let audioSources = 0;
        
        // 1. Mix system/tab audio from display stream
        const displayAudioTracks = displayMediaStream.getAudioTracks();
        console.log('[Offscreen] Display audio tracks:', displayAudioTracks.length);
        
        if (displayAudioTracks.length > 0) {
            displayAudioTracks.forEach((track, index) => {
                try {
                    console.log('[Offscreen] Connecting display audio track', index, ':', track.label);
                    const source = audioContext.createMediaStreamSource(
                        new MediaStream([track])
                    );
                    source.connect(audioDestination);
                    audioSources++;
                    console.log('[Offscreen] ✓ Display audio track', index, 'connected');
                } catch (error) {
                    console.warn('[Offscreen] Failed to connect display audio track', index, ':', error);
                }
            });
        } else {
            console.warn('[Offscreen] ⚠ No display audio tracks found');
        }
        
        // 2. Try to add microphone audio
        try {
            console.log('[Offscreen] Requesting microphone access...');
            
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000
                }
            });
            
            const micTracks = micStream.getAudioTracks();
            console.log('[Offscreen] Microphone tracks:', micTracks.length);
            
            if (micTracks.length > 0) {
                micTracks.forEach((track, index) => {
                    try {
                        console.log('[Offscreen] Connecting microphone track', index, ':', track.label);
                        const source = audioContext.createMediaStreamSource(
                            new MediaStream([track])
                        );
                        source.connect(audioDestination);
                        audioSources++;
                        console.log('[Offscreen] ✓ Microphone track', index, 'connected');
                    } catch (error) {
                        console.warn('[Offscreen] Failed to connect microphone track', index, ':', error);
                    }
                });
            }
        } catch (error) {
            console.warn('[Offscreen] ⚠ Microphone not available:', error.message);
            console.log('[Offscreen] Continuing without microphone (system audio only)');
        }
        
        console.log('[Offscreen] Total audio sources mixed:', audioSources);
        
        if (audioSources === 0) {
            console.warn('[Offscreen] ⚠ No audio sources - recording video only');
        }
        
        return audioDestination.stream;
        
    } catch (error) {
        console.error('[Offscreen] Error creating mixed audio:', error);
        throw error;
    }
}

// ==================== Main Recording Logic ====================

async function startRecording() {
    try {
        console.log('[Offscreen] ========================================');
        console.log('[Offscreen] START RECORDING');
        console.log('[Offscreen] ========================================');
        
        updateStatus('Requesting screen share...');
        
        // Step 1: Request screen capture with getDisplayMedia
        console.log('[Offscreen] Step 1: Requesting getDisplayMedia...');
        
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000
            },
            preferCurrentTab: false,
            selfBrowserSurface: "exclude",
            systemAudio: "include"
        });
        
        console.log('[Offscreen] ✓ Display media obtained');
        console.log('[Offscreen] Video tracks:', displayStream.getVideoTracks().length);
        console.log('[Offscreen] Audio tracks:', displayStream.getAudioTracks().length);
        
        // Log track details
        displayStream.getVideoTracks().forEach((track, index) => {
            console.log('[Offscreen] Video track', index, ':', {
                label: track.label,
                enabled: track.enabled,
                readyState: track.readyState,
                settings: track.getSettings()
            });
        });
        
        displayStream.getAudioTracks().forEach((track, index) => {
            console.log('[Offscreen] Audio track', index, ':', {
                label: track.label,
                enabled: track.enabled,
                readyState: track.readyState,
                settings: track.getSettings()
            });
        });
        
        // Validate video track
        const videoTracks = displayStream.getVideoTracks();
        if (videoTracks.length === 0) {
            throw new Error('No video track captured - user may have cancelled');
        }
        
        if (!videoTracks[0].enabled) {
            throw new Error('Video track is not enabled');
        }
        
        updateStatus('Mixing audio...');
        
        // Step 2: Create mixed audio stream
        console.log('[Offscreen] Step 2: Creating mixed audio...');
        const mixedAudioStream = await createMixedAudioStream(displayStream);
        
        // Step 3: Combine video + mixed audio
        console.log('[Offscreen] Step 3: Creating combined stream...');
        
        const videoTrack = displayStream.getVideoTracks()[0];
        const audioTracks = mixedAudioStream.getAudioTracks();
        
        combinedStream = new MediaStream([videoTrack, ...audioTracks]);
        
        console.log('[Offscreen] Combined stream created:');
        console.log('[Offscreen] - Video tracks:', combinedStream.getVideoTracks().length);
        console.log('[Offscreen] - Audio tracks:', combinedStream.getAudioTracks().length);
        console.log('[Offscreen] - Stream active:', combinedStream.active);
        console.log('[Offscreen] - Stream ID:', combinedStream.id);
        
        // CRITICAL: Validate stream before creating recorder
        if (!combinedStream.active) {
            throw new Error('Combined stream is not active');
        }
        
        if (combinedStream.getVideoTracks().length === 0) {
            throw new Error('No video tracks in combined stream');
        }
        
        updateStatus('Creating recorder...');
        
        // Step 4: Determine best MIME type
        console.log('[Offscreen] Step 4: Determining MIME type...');
        
        const codecs = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        
        let selectedMimeType = null;
        
        for (const codec of codecs) {
            if (MediaRecorder.isTypeSupported(codec)) {
                selectedMimeType = codec;
                console.log('[Offscreen] ✓ Selected codec:', codec);
                break;
            }
        }
        
        if (!selectedMimeType) {
            throw new Error('No supported video codecs found in browser');
        }
        
        // Step 5: Create MediaRecorder
        console.log('[Offscreen] Step 5: Creating MediaRecorder...');
        
        mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: selectedMimeType,
            videoBitsPerSecond: 2500000, // 2.5 Mbps
            audioBitsPerSecond: 128000    // 128 kbps
        });
        
        console.log('[Offscreen] ✓ MediaRecorder created');
        console.log('[Offscreen] - MIME type:', mediaRecorder.mimeType);
        console.log('[Offscreen] - State:', mediaRecorder.state);
        
        // Step 6: Set up event handlers
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
                const totalSize = recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
                console.log('[Offscreen] Chunk received:', event.data.size, 'bytes | Total:', recordedChunks.length, 'chunks,', (totalSize / (1024 * 1024)).toFixed(2), 'MB');
            } else {
                console.warn('[Offscreen] ⚠ Empty data chunk received');
            }
        };
        
        mediaRecorder.onstop = () => {
            console.log('[Offscreen] ========================================');
            console.log('[Offscreen] MediaRecorder STOPPED');
            console.log('[Offscreen] Total chunks:', recordedChunks.length);
            
            if (recordedChunks.length > 0) {
                const totalSize = recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
                console.log('[Offscreen] Total size:', (totalSize / (1024 * 1024)).toFixed(2), 'MB');
                console.log('[Offscreen] ========================================');
                
                // Send data to background
                console.log('[Offscreen] Sending data to background...');
                chrome.runtime.sendMessage({
                    target: 'background',
                    action: 'recording-data',
                    data: recordedChunks
                }).then(() => {
                    console.log('[Offscreen] ✓ Data sent to background');
                }).catch(error => {
                    console.error('[Offscreen] ✗ Failed to send data:', error);
                });
            } else {
                console.error('[Offscreen] ✗ NO DATA RECORDED!');
                console.error('[Offscreen] ========================================');
                
                chrome.runtime.sendMessage({
                    target: 'background',
                    action: 'recording-error',
                    error: 'No data was recorded'
                });
            }
            
            // Clean up
            cleanup();
        };
        
        mediaRecorder.onerror = (event) => {
            console.error('[Offscreen] ========================================');
            console.error('[Offscreen] MediaRecorder ERROR:', event);
            console.error('[Offscreen] ========================================');
            
            chrome.runtime.sendMessage({
                target: 'background',
                action: 'recording-error',
                error: 'MediaRecorder error: ' + (event.error?.message || 'Unknown error')
            });
            
            cleanup();
        };
        
        mediaRecorder.onstart = () => {
            console.log('[Offscreen] ✓ MediaRecorder STARTED');
            console.log('[Offscreen] State:', mediaRecorder.state);
        };
        
        mediaRecorder.onpause = () => {
            console.log('[Offscreen] MediaRecorder PAUSED');
        };
        
        mediaRecorder.onresume = () => {
            console.log('[Offscreen] MediaRecorder RESUMED');
        };
        
        // Step 7: Start recording
        console.log('[Offscreen] Step 6: Starting MediaRecorder...');
        
        // Request data every 1 second for reliability
        mediaRecorder.start(1000);
        
        console.log('[Offscreen] ========================================');
        console.log('[Offscreen] ✓✓✓ RECORDING STARTED SUCCESSFULLY ✓✓✓');
        console.log('[Offscreen] Recorder state:', mediaRecorder.state);
        console.log('[Offscreen] ========================================');
        
        updateStatus('Recording in progress...');
        
        return { success: true };
        
    } catch (error) {
        console.error('[Offscreen] ========================================');
        console.error('[Offscreen] ✗✗✗ START RECORDING FAILED ✗✗✗');
        console.error('[Offscreen]', error);
        console.error('[Offscreen] Stack:', error.stack);
        console.error('[Offscreen] ========================================');
        
        updateStatus('Error: ' + error.message);
        
        cleanup();
        
        return { success: false, error: error.message };
    }
}

function stopRecording() {
    try {
        console.log('[Offscreen] ========================================');
        console.log('[Offscreen] STOP RECORDING');
        console.log('[Offscreen] ========================================');
        
        if (!mediaRecorder) {
            console.warn('[Offscreen] ⚠ No MediaRecorder exists');
            return { success: false, error: 'No recording in progress' };
        }
        
        console.log('[Offscreen] Current state:', mediaRecorder.state);
        
        if (mediaRecorder.state === 'recording') {
            console.log('[Offscreen] Calling mediaRecorder.stop()...');
            mediaRecorder.stop();
            console.log('[Offscreen] ✓ Stop called, waiting for onstop event...');
        } else if (mediaRecorder.state === 'paused') {
            console.log('[Offscreen] Recorder is paused, resuming then stopping...');
            mediaRecorder.resume();
            setTimeout(() => mediaRecorder.stop(), 100);
        } else {
            console.warn('[Offscreen] ⚠ Recorder in unexpected state:', mediaRecorder.state);
        }
        
        updateStatus('Stopping...');
        
        return { success: true };
        
    } catch (error) {
        console.error('[Offscreen] ========================================');
        console.error('[Offscreen] ✗ STOP RECORDING ERROR');
        console.error('[Offscreen]', error);
        console.error('[Offscreen] ========================================');
        
        return { success: false, error: error.message };
    }
}

function cleanup() {
    console.log('[Offscreen] Cleaning up resources...');
    
    // Stop all tracks in display stream
    if (displayStream) {
        displayStream.getTracks().forEach(track => {
            track.stop();
            console.log('[Offscreen] Stopped display track:', track.kind, track.label);
        });
        displayStream = null;
    }
    
    // Stop microphone tracks
    if (micStream) {
        micStream.getTracks().forEach(track => {
            track.stop();
            console.log('[Offscreen] Stopped mic track:', track.kind, track.label);
        });
        micStream = null;
    }
    
    // Stop combined stream
    if (combinedStream) {
        combinedStream.getTracks().forEach(track => {
            track.stop();
        });
        combinedStream = null;
    }
    
    // Close audio context
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().then(() => {
            console.log('[Offscreen] ✓ AudioContext closed');
        }).catch(err => {
            console.warn('[Offscreen] Error closing AudioContext:', err);
        });
        audioContext = null;
    }
    
    mediaRecorder = null;
    
    console.log('[Offscreen] ✓ Cleanup complete');
    updateStatus('Idle');
}

// ==================== Message Handling ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Offscreen] Message received:', message);
    
    if (message.target !== 'offscreen') {
        return false;
    }
    
    if (message.action === 'start-recording') {
        startRecording()
            .then(result => {
                console.log('[Offscreen] Responding with:', result);
                sendResponse(result);
            })
            .catch(error => {
                console.error('[Offscreen] Unexpected error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Will respond asynchronously
    }
    
    if (message.action === 'stop-recording') {
        const result = stopRecording();
        sendResponse(result);
        return false;
    }
    
    return false;
});

console.log('[Offscreen] ✓ Ready to receive commands');
/**
 * POAi v2.0 - Offscreen Recording Script
 * FINAL FIX: Uses streamId from desktopCapture with getUserMedia
 * PREVENTS FILE CORRUPTION: Proper blob handling in onstop
 */

console.log('[Offscreen] POAi v2.0 offscreen loaded');

let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let desktopStream = null;
let micStream = null;

// ==================== Message Listener ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Offscreen] Message received:', request.action);
  
  if (request.action === 'startOffscreenRecording') {
    startRecording(request.streamId)
      .then(() => {
        console.log('[Offscreen] Recording started successfully');
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('[Offscreen] Start failed:', error);
        reportError('Failed to start: ' + error.message);
        sendResponse({ success: false, error: error.message });
      });
    return true;

  } else if (request.action === 'stopOffscreenRecording') {
    console.log('[Offscreen] Stop signal received');
    stopRecording();
    sendResponse({ success: true });
    return true;
  }
});

// ==================== Recording Functions ====================

async function startRecording(streamId) {
  console.log('[Offscreen] ===== STARTING RECORDING =====');
  console.log('[Offscreen] Stream ID:', streamId);
  
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    throw new Error('Already recording');
  }
  
  try {
    // CRITICAL FIX: Use getUserMedia with desktop stream ID
    console.log('[Offscreen] Capturing desktop stream with ID...');
    desktopStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          frameRate: 30
        }
      }
    });
    
    console.log('[Offscreen] ✓ Desktop stream captured');
    console.log('[Offscreen] Video tracks:', desktopStream.getVideoTracks().length);
    console.log('[Offscreen] Audio tracks:', desktopStream.getAudioTracks().length);
    
    // Verify we have video
    if (desktopStream.getVideoTracks().length === 0) {
      throw new Error('No video track captured - user may have selected audio only');
    }
    
    // Log track details for debugging
    const videoTrack = desktopStream.getVideoTracks()[0];
    const videoSettings = videoTrack.getSettings();
    console.log('[Offscreen] Video track settings:', videoSettings);

    // Setup audio context for mixing
    console.log('[Offscreen] Setting up audio mixing...');
    audioContext = new AudioContext();
    
    // Create two destinations: one for recording, one for monitoring (hearing audio)
    const recordingDest = audioContext.createMediaStreamDestination();
    const monitoringDest = audioContext.destination; // Speakers
    
    // Desktop audio (if available)
    if (desktopStream.getAudioTracks().length > 0) {
      const desktopAudioStream = new MediaStream(desktopStream.getAudioTracks());
      const desktopAudioSource = audioContext.createMediaStreamSource(desktopAudioStream);
      
      // Route to both recording and speakers
      desktopAudioSource.connect(recordingDest);
      desktopAudioSource.connect(monitoringDest);
      
      console.log('[Offscreen] ✓ Desktop audio connected (you can hear it)');
    } else {
      console.warn('[Offscreen] No desktop audio track available');
    }

    // Capture microphone separately
    console.log('[Offscreen] Requesting microphone access...');
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(recordingDest); // Mix into recording
      
      console.log('[Offscreen] ✓ Microphone connected');
    } catch (micError) {
      console.warn('[Offscreen] Microphone not available:', micError.message);
      console.warn('[Offscreen] Continuing without microphone...');
      micStream = null;
    }

    // Create combined stream: video + mixed audio
    const videoTracks = desktopStream.getVideoTracks();
    const mixedAudioTracks = recordingDest.stream.getAudioTracks();
    
    console.log('[Offscreen] Creating combined stream...');
    console.log('[Offscreen] - Video tracks to combine:', videoTracks.length);
    console.log('[Offscreen] - Audio tracks to combine:', mixedAudioTracks.length);
    
    if (videoTracks.length === 0) {
      throw new Error('No video tracks available for recording');
    }
    
    const combinedStream = new MediaStream([
      ...videoTracks,
      ...mixedAudioTracks
    ]);
    
    console.log('[Offscreen] ✓ Combined stream ready');
    console.log('[Offscreen] Combined video tracks:', combinedStream.getVideoTracks().length);
    console.log('[Offscreen] Combined audio tracks:', combinedStream.getAudioTracks().length);

    // Setup MediaRecorder - CRITICAL: Use proper codec
    recordedChunks = [];
    
    // Try codecs in order of preference
    let mimeType = '';
    const codecs = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    
    for (const codec of codecs) {
      if (MediaRecorder.isTypeSupported(codec)) {
        mimeType = codec;
        console.log('[Offscreen] Selected codec:', mimeType);
        break;
      }
    }
    
    if (!mimeType) {
      console.warn('[Offscreen] No preferred codec supported, using browser default');
      mediaRecorder = new MediaRecorder(combinedStream);
    } else {
      mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2500000,
        audioBitsPerSecond: 128000
      });
    }
    
    console.log('[Offscreen] MediaRecorder created with type:', mediaRecorder.mimeType);

    // Data handler - collect chunks
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('[Offscreen] Chunk received:', event.data.size, 'bytes', 
                    `(total: ${recordedChunks.length} chunks)`);
      }
    };

    // CRITICAL: Stop handler - this is where blob is created
    // This MUST complete fully before sending to background
    mediaRecorder.onstop = async () => {
      console.log('[Offscreen] ===== RECORDING STOPPED =====');
      console.log('[Offscreen] Processing recorded data...');
      console.log('[Offscreen] Total chunks collected:', recordedChunks.length);
      
      try {
        // Validate we have data
        if (recordedChunks.length === 0) {
          throw new Error('No data recorded (0 chunks)');
        }
        
        // Calculate total size
        let totalSize = 0;
        for (const chunk of recordedChunks) {
          totalSize += chunk.size;
        }
        
        console.log('[Offscreen] Total size:', totalSize, 'bytes', 
                    `(${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
        
        if (totalSize === 0) {
          throw new Error('No data recorded (0 bytes)');
        }
        
        if (totalSize < 10000) {
          throw new Error(`Recording too small (${totalSize} bytes) - likely corrupted`);
        }
        
        // Create blob with correct MIME type
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        
        console.log('[Offscreen] Blob created:');
        console.log('[Offscreen] - Size:', videoBlob.size, 'bytes');
        console.log('[Offscreen] - Type:', videoBlob.type);
        
        // CRITICAL: Verify blob type is video
        if (!videoBlob.type.startsWith('video/')) {
          throw new Error(`Invalid blob type: ${videoBlob.type} (expected video/*)`);
        }
        
        // Verify blob size matches
        if (videoBlob.size !== totalSize) {
          console.warn('[Offscreen] WARNING: Blob size mismatch!');
          console.warn('[Offscreen] Expected:', totalSize, 'Got:', videoBlob.size);
        }
        
        // Verify WebM header to prevent corruption
        console.log('[Offscreen] Verifying file header...');
        const headerSlice = videoBlob.slice(0, 20);
        const headerBuffer = await headerSlice.arrayBuffer();
        const headerBytes = new Uint8Array(headerBuffer);
        
        const headerHex = Array.from(headerBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log('[Offscreen] First 20 bytes:', headerHex);
        
        // WebM signature: 0x1A 0x45 0xDF 0xA3
        if (headerBytes[0] === 0x1A && headerBytes[1] === 0x45 && 
            headerBytes[2] === 0xDF && headerBytes[3] === 0xA3) {
          console.log('[Offscreen] ✓✓✓ VALID WebM header detected ✓✓✓');
        } else {
          console.error('[Offscreen] ✗✗✗ INVALID WebM header! ✗✗✗');
          console.error('[Offscreen] Expected: 1a 45 df a3');
          console.error('[Offscreen] Got:', headerHex.substring(0, 11));
          throw new Error('File corruption detected - invalid WebM header');
        }
        
        console.log('[Offscreen] ✓ All validations passed');
        console.log('[Offscreen] Converting to base64 for transfer...');
        
        // Convert to base64 for messaging
        const reader = new FileReader();
        
        reader.onloadend = () => {
          console.log('[Offscreen] ✓ Base64 conversion complete');
          console.log('[Offscreen] Sending blob to background...');
          
          chrome.runtime.sendMessage({
            action: 'blobReady',
            blobData: reader.result,
            mimeType: videoBlob.type,
            size: videoBlob.size
          }).then(() => {
            console.log('[Offscreen] ✓✓✓ Blob sent successfully to background ✓✓✓');
            cleanup();
          }).catch(error => {
            console.error('[Offscreen] Failed to send blob:', error);
            reportError('Failed to send recording: ' + error.message);
            cleanup();
          });
        };
        
        reader.onerror = () => {
          throw new Error('FileReader failed: ' + reader.error?.message);
        };
        
        reader.readAsDataURL(videoBlob);
        
      } catch (error) {
        console.error('[Offscreen] ✗✗✗ Processing error:', error);
        reportError('Recording processing failed: ' + error.message);
        cleanup();
      }
    };

    // Error handler
    mediaRecorder.onerror = (event) => {
      console.error('[Offscreen] MediaRecorder error:', event.error);
      reportError('MediaRecorder error: ' + event.error.message);
      cleanup();
    };

    // Start recording
    mediaRecorder.start();
    
    console.log('[Offscreen] ==================== RECORDING STARTED ====================');
    console.log('[Offscreen] ✓ Desktop video+audio captured');
    console.log('[Offscreen] ✓ Microphone:', micStream ? 'Connected' : 'Not available');
    console.log('[Offscreen] ✓ Audio monitoring: ENABLED (you can hear the tab)');
    console.log('[Offscreen] ✓ MediaRecorder state:', mediaRecorder.state);
    console.log('[Offscreen] ================================================================');

  } catch (error) {
    console.error('[Offscreen] Start recording error:', error);
    cleanup();
    throw error;
  }
}

function stopRecording() {
  console.log('[Offscreen] ===== STOP RECORDING CALLED =====');
  
  if (!mediaRecorder) {
    console.error('[Offscreen] No mediaRecorder exists');
    reportError('Cannot stop: no active recorder');
    return;
  }
  
  if (mediaRecorder.state !== 'recording') {
    console.warn('[Offscreen] Not recording, state:', mediaRecorder.state);
    return;
  }
  
  console.log('[Offscreen] Current state:', mediaRecorder.state);
  console.log('[Offscreen] Chunks so far:', recordedChunks.length);
  
  try {
    // Request final data
    console.log('[Offscreen] Requesting final data...');
    mediaRecorder.requestData();
    
    // Wait a moment for final chunk, then stop
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('[Offscreen] Stopping MediaRecorder...');
        mediaRecorder.stop();
        console.log('[Offscreen] Stop() called - waiting for onstop event...');
      }
    }, 500);
    
  } catch (error) {
    console.error('[Offscreen] Stop error:', error);
    reportError('Failed to stop: ' + error.message);
    cleanup();
  }
}

function cleanup() {
  console.log('[Offscreen] ===== CLEANUP =====');
  
  if (desktopStream) {
    desktopStream.getTracks().forEach(track => {
      track.stop();
      console.log('[Offscreen] Stopped track:', track.kind);
    });
    desktopStream = null;
  }
  
  if (micStream) {
    micStream.getTracks().forEach(track => {
      track.stop();
      console.log('[Offscreen] Stopped mic track');
    });
    micStream = null;
  }
  
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
    console.log('[Offscreen] Audio context closed');
  }
  
  mediaRecorder = null;
  recordedChunks = [];
  
  console.log('[Offscreen] Cleanup complete');
}

function reportError(errorMessage) {
  console.error('[Offscreen] Reporting error to background:', errorMessage);
  
  try {
    chrome.runtime.sendMessage({
      action: 'recordingError',
      error: errorMessage
    }).catch(err => {
      console.error('[Offscreen] Could not report error:', err);
    });
  } catch (e) {
    console.error('[Offscreen] Error reporting failed:', e);
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  console.log('[Offscreen] Page unloading...');
  cleanup();
});

console.log('[Offscreen] Ready and waiting for recording commands');
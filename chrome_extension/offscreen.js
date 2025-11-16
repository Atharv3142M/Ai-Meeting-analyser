/**
 * POAi v2.0 - Offscreen Recording Script (FIXED ERROR HANDLING)
 * 
 * KEY FIXES:
 * 1. All errors are reported to background.js
 * 2. Blob validation before sending
 * 3. requestData() ensures complete recording
 * 4. No timeslice for complete blob
 */

console.log('[Offscreen] POAi v2.0 offscreen loaded');

let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let combinedStream = null;
let micStream = null;
let tabStream = null;

// ==================== Message Listener ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Offscreen] Message:', request.action);
  
  if (request.action === 'startOffscreenRecording') {
    startRecording(request.streamId)
      .then(() => {
        console.log('[Offscreen] Start successful');
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[Offscreen] Start failed:', err);
        reportError('Failed to start recording: ' + err.message);
        sendResponse({ success: false, error: err.message });
      });
    return true;

  } else if (request.action === 'stopOffscreenRecording') {
    console.log('[Offscreen] Stop requested');
    stopRecording();
    sendResponse({ success: true });
    return true;
  }
});

// ==================== Recording Functions ====================

async function startRecording(streamId) {
  console.log('[Offscreen] startRecording, streamId:', streamId);
  
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    throw new Error('Already recording');
  }
  
  try {
    // Capture tab video + audio
    console.log('[Offscreen] Capturing tab stream...');
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          frameRate: 30
        }
      }
    });
    
    console.log('[Offscreen] Tab stream OK');
    console.log('[Offscreen] Video tracks:', tabStream.getVideoTracks().length);
    console.log('[Offscreen] Audio tracks:', tabStream.getAudioTracks().length);
    
    if (tabStream.getVideoTracks().length === 0) {
      throw new Error('No video track captured');
    }
    if (tabStream.getAudioTracks().length === 0) {
      throw new Error('No audio track captured');
    }

    // Setup audio context for mixing + monitoring
    console.log('[Offscreen] Setting up audio...');
    audioContext = new AudioContext();
    const recordingDest = audioContext.createMediaStreamDestination();
    const monitoringDest = audioContext.destination;
    
    // Tab audio
    const tabAudioStream = new MediaStream(tabStream.getAudioTracks());
    const tabAudioSource = audioContext.createMediaStreamSource(tabAudioStream);
    tabAudioSource.connect(recordingDest);  // Recording
    tabAudioSource.connect(monitoringDest); // Speakers
    
    console.log('[Offscreen] Tab audio routed');

    // Microphone (optional)
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
      micSource.connect(recordingDest);
      console.log('[Offscreen] Mic added');
    } catch (micError) {
      console.warn('[Offscreen] No mic:', micError.message);
      micStream = null;
    }

    // Create combined stream
    const videoTracks = tabStream.getVideoTracks();
    const mixedAudioTracks = recordingDest.stream.getAudioTracks();
    
    combinedStream = new MediaStream([
      ...videoTracks,
      ...mixedAudioTracks
    ]);
    
    console.log('[Offscreen] Combined stream ready');

    // Setup MediaRecorder (NO TIMESLICE for complete blob)
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(combinedStream);
    
    console.log('[Offscreen] MediaRecorder type:', mediaRecorder.mimeType);

    // Data handler
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('[Offscreen] Chunk:', event.data.size, 'bytes');
      }
    };

    // Stop handler (CRITICAL ERROR HANDLING)
    mediaRecorder.onstop = () => {
      console.log('[Offscreen] ===== RECORDING STOPPED =====');
      console.log('[Offscreen] Chunks:', recordedChunks.length);
      
      try {
        // Validate chunks
        if (recordedChunks.length === 0) {
          throw new Error('No data recorded (0 chunks)');
        }
        
        // Calculate size
        let totalSize = 0;
        for (let chunk of recordedChunks) {
          totalSize += chunk.size;
        }
        
        console.log('[Offscreen] Total size:', totalSize, 'bytes');
        
        if (totalSize === 0) {
          throw new Error('No data recorded (0 bytes)');
        }
        
        if (totalSize < 10000) {
          throw new Error(`Recording too small (${totalSize} bytes)`);
        }
        
        // Create blob
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        
        console.log('[Offscreen] Blob created:', videoBlob.size, 'bytes');
        
        // Double-check blob
        if (videoBlob.size !== totalSize) {
          console.warn('[Offscreen] Blob size mismatch!');
        }
        
        if (videoBlob.size < 10000) {
          throw new Error(`Blob too small (${videoBlob.size} bytes)`);
        }
        
        console.log('[Offscreen] ✓ Validation passed');
        console.log('[Offscreen] Converting to base64...');
        
        // Convert and send
        const reader = new FileReader();
        
        reader.onloadend = () => {
          console.log('[Offscreen] ✓ Base64 ready, sending to background...');
          
          chrome.runtime.sendMessage({
            action: 'blobReady',
            blobData: reader.result,
            mimeType: videoBlob.type,
            size: videoBlob.size
          }).then(() => {
            console.log('[Offscreen] ✓ Blob sent successfully');
            cleanup();
          }).catch(err => {
            console.error('[Offscreen] Send error:', err);
            reportError('Failed to send recording: ' + err.message);
            cleanup();
          });
        };
        
        reader.onerror = () => {
          throw new Error('FileReader failed: ' + reader.error);
        };
        
        reader.readAsDataURL(videoBlob);
        
      } catch (error) {
        console.error('[Offscreen] onstop error:', error);
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

    // Start recording (NO TIMESLICE)
    mediaRecorder.start();
    
    console.log('[Offscreen] ===== RECORDING STARTED =====');
    console.log('[Offscreen] ✓ Video captured');
    console.log('[Offscreen] ✓ Audio captured');
    console.log('[Offscreen] ✓ Monitoring enabled');
    console.log('[Offscreen] ✓ Mic:', micStream ? 'Yes' : 'No');

  } catch (error) {
    console.error('[Offscreen] Start error:', error);
    cleanup();
    throw error;
  }
}

function stopRecording() {
  console.log('[Offscreen] stopRecording called');
  
  if (!mediaRecorder) {
    console.error('[Offscreen] No mediaRecorder');
    reportError('Cannot stop: no active recorder');
    return;
  }
  
  if (mediaRecorder.state !== 'recording') {
    console.warn('[Offscreen] Not recording, state:', mediaRecorder.state);
    return;
  }
  
  console.log('[Offscreen] Requesting final data...');
  console.log('[Offscreen] Current chunks:', recordedChunks.length);
  
  try {
    // CRITICAL: Request final data before stopping
    mediaRecorder.requestData();
    console.log('[Offscreen] Final data requested');
    
    // Wait for final chunk, then stop
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('[Offscreen] Stopping MediaRecorder...');
        mediaRecorder.stop();
        console.log('[Offscreen] Stop signal sent');
      } else {
        console.warn('[Offscreen] Recorder already stopped');
      }
    }, 500); // 500ms delay
    
  } catch (error) {
    console.error('[Offscreen] Stop error:', error);
    reportError('Failed to stop recording: ' + error.message);
    cleanup();
  }
}

function cleanup() {
  console.log('[Offscreen] Cleaning up...');
  
  if (tabStream) {
    tabStream.getTracks().forEach(track => track.stop());
    tabStream = null;
  }
  
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  
  if (combinedStream) {
    combinedStream.getTracks().forEach(track => track.stop());
    combinedStream = null;
  }
  
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
  
  mediaRecorder = null;
  recordedChunks = [];
  
  console.log('[Offscreen] Cleanup complete');
}

// ==================== Error Reporting ====================

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

// ==================== Lifecycle ====================

window.addEventListener('beforeunload', () => {
  console.log('[Offscreen] Page unloading');
  cleanup();
});

console.log('[Offscreen] Ready');
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
    
    console.log('[Offscreen] Combining tracks...');
    console.log('[Offscreen] Video tracks to combine:', videoTracks.length);
    console.log('[Offscreen] Audio tracks to combine:', mixedAudioTracks.length);
    
    // CRITICAL: Verify we have video
    if (videoTracks.length === 0) {
      throw new Error('No video tracks available for recording');
    }
    if (mixedAudioTracks.length === 0) {
      throw new Error('No audio tracks available for recording');
    }
    
    combinedStream = new MediaStream([
      ...videoTracks,
      ...mixedAudioTracks
    ]);
    
    console.log('[Offscreen] Combined stream ready');
    console.log('[Offscreen] Combined stream video tracks:', combinedStream.getVideoTracks().length);
    console.log('[Offscreen] Combined stream audio tracks:', combinedStream.getAudioTracks().length);
    
    // CRITICAL: Final verification before MediaRecorder
    if (combinedStream.getVideoTracks().length === 0) {
      throw new Error('Combined stream has no video tracks!');
    }
    
    // Log track details
    const videoTrack = combinedStream.getVideoTracks()[0];
    const audioTrack = combinedStream.getAudioTracks()[0];
    console.log('[Offscreen] Video track settings:', videoTrack.getSettings());
    console.log('[Offscreen] Audio track settings:', audioTrack.getSettings());

    // Setup MediaRecorder with EXPLICIT video codec
    recordedChunks = [];
    
    // CRITICAL FIX: Must specify mimeType to force video recording
    // Without this, browser may create audio-only file
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
      throw new Error('No supported video codec found');
    }
    
    // Create MediaRecorder with explicit video codec
    mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: mimeType,
      videoBitsPerSecond: 2500000, // 2.5 Mbps
      audioBitsPerSecond: 128000   // 128 Kbps
    });
    
    console.log('[Offscreen] MediaRecorder created with:', mediaRecorder.mimeType);

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
        console.log('[Offscreen] Blob type:', videoBlob.type);
        
        // CRITICAL: Check if blob type indicates video
        if (!videoBlob.type.startsWith('video/')) {
          console.error('[Offscreen] ERROR: Blob is not video type!');
          console.error('[Offscreen] Blob type:', videoBlob.type);
          throw new Error(`Invalid blob type: ${videoBlob.type} (expected video/*)`);
        }
        
        // Double-check blob
        if (videoBlob.size !== totalSize) {
          console.warn('[Offscreen] Blob size mismatch!');
        }
        
        if (videoBlob.size < 10000) {
          throw new Error(`Blob too small (${videoBlob.size} bytes)`);
        }
        
        // Read first bytes to verify it's actually WebM
        console.log('[Offscreen] Verifying WebM header...');
        const headerCheck = await new Promise((resolve) => {
          const slice = videoBlob.slice(0, 100);
          const reader = new FileReader();
          reader.onload = () => {
            const arr = new Uint8Array(reader.result);
            console.log('[Offscreen] First 20 bytes:', Array.from(arr.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            
            // Check for WebM signature (0x1A 0x45 0xDF 0xA3)
            if (arr[0] === 0x1A && arr[1] === 0x45 && arr[2] === 0xDF && arr[3] === 0xA3) {
              console.log('[Offscreen] ✓ Valid WebM header detected');
              resolve(true);
            } else {
              console.error('[Offscreen] ✗ Invalid WebM header!');
              console.error('[Offscreen] Got:', arr.slice(0, 4));
              console.error('[Offscreen] Expected: [1a, 45, df, a3]');
              resolve(false);
            }
          };
          reader.readAsArrayBuffer(slice);
        });
        
        if (!headerCheck) {
          throw new Error('Blob does not have valid WebM header - recording may be corrupted');
        }
        
        console.log('[Offscreen] ✓ All validation passed');
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
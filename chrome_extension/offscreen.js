/**
 * POAi v2.0 - Offscreen Recording Script
 * FIXED: Properly combines desktopCapture stream + microphone to create valid video/webm
 */

console.log('[Offscreen] POAi v2.0 offscreen loaded');

let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let desktopStream = null;
let micStream = null;
let combinedStream = null;

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
    // FIXED: Get desktop stream using the streamId from desktopCapture
    console.log('[Offscreen] Getting desktop stream...');
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
    
    console.log('[Offscreen] Desktop stream OK');
    console.log('[Offscreen] Video tracks:', desktopStream.getVideoTracks().length);
    console.log('[Offscreen] Audio tracks:', desktopStream.getAudioTracks().length);
    
    if (desktopStream.getVideoTracks().length === 0) {
      throw new Error('No video track captured from desktop');
    }

    // Setup audio context for mixing
    console.log('[Offscreen] Setting up audio mixing...');
    audioContext = new AudioContext();
    const recordingDest = audioContext.createMediaStreamDestination();
    const monitoringDest = audioContext.destination;
    
    // Desktop audio (if available)
    if (desktopStream.getAudioTracks().length > 0) {
      const desktopAudioStream = new MediaStream(desktopStream.getAudioTracks());
      const desktopAudioSource = audioContext.createMediaStreamSource(desktopAudioStream);
      desktopAudioSource.connect(recordingDest);  // For recording
      desktopAudioSource.connect(monitoringDest); // For monitoring (user can hear)
      console.log('[Offscreen] Desktop audio routed');
    } else {
      console.warn('[Offscreen] No desktop audio available');
    }

    // FIXED: Manually get microphone
    console.log('[Offscreen] Requesting microphone...');
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
      micSource.connect(recordingDest);  // Mix into recording
      console.log('[Offscreen] Microphone added');
    } catch (micError) {
      console.warn('[Offscreen] No microphone:', micError.message);
      micStream = null;
    }

    // FIXED: Create combined stream with video + mixed audio
    const videoTracks = desktopStream.getVideoTracks();
    const mixedAudioTracks = recordingDest.stream.getAudioTracks();
    
    console.log('[Offscreen] Combining tracks...');
    console.log('[Offscreen] Video tracks:', videoTracks.length);
    console.log('[Offscreen] Audio tracks:', mixedAudioTracks.length);
    
    if (videoTracks.length === 0) {
      throw new Error('No video tracks available for recording');
    }
    
    combinedStream = new MediaStream([
      ...videoTracks,
      ...mixedAudioTracks
    ]);
    
    console.log('[Offscreen] Combined stream ready');
    console.log('[Offscreen] Combined video tracks:', combinedStream.getVideoTracks().length);
    console.log('[Offscreen] Combined audio tracks:', combinedStream.getAudioTracks().length);
    
    if (combinedStream.getVideoTracks().length === 0) {
      throw new Error('Combined stream has no video tracks!');
    }
    
    // Log track settings
    const videoTrack = combinedStream.getVideoTracks()[0];
    const audioTrack = combinedStream.getAudioTracks()[0];
    console.log('[Offscreen] Video settings:', videoTrack.getSettings());
    if (audioTrack) {
      console.log('[Offscreen] Audio settings:', audioTrack.getSettings());
    }

    // FIXED: Setup MediaRecorder with explicit video/webm codec
    recordedChunks = [];
    
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
    
    mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: mimeType,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 128000
    });
    
    console.log('[Offscreen] MediaRecorder created with:', mediaRecorder.mimeType);

    // Data handler
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('[Offscreen] Chunk received:', event.data.size, 'bytes');
      }
    };

    // Stop handler - CRITICAL for proper file creation
    mediaRecorder.onstop = async () => {
      console.log('[Offscreen] ===== RECORDING STOPPED =====');
      console.log('[Offscreen] Total chunks:', recordedChunks.length);
      
      try {
        if (recordedChunks.length === 0) {
          throw new Error('No data recorded (0 chunks)');
        }
        
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
        
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        
        console.log('[Offscreen] Blob created:', videoBlob.size, 'bytes');
        console.log('[Offscreen] Blob type:', videoBlob.type);
        
        if (!videoBlob.type.startsWith('video/')) {
          throw new Error(`Invalid blob type: ${videoBlob.type} (expected video/*)`);
        }
        
        if (videoBlob.size < 10000) {
          throw new Error(`Blob too small (${videoBlob.size} bytes)`);
        }
        
        // Verify WebM header
        console.log('[Offscreen] Verifying WebM header...');
        const slice = videoBlob.slice(0, 100);
        const arrayBuffer = await slice.arrayBuffer();
        const arr = new Uint8Array(arrayBuffer);
        console.log('[Offscreen] First 20 bytes:', Array.from(arr.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        if (arr[0] === 0x1A && arr[1] === 0x45 && arr[2] === 0xDF && arr[3] === 0xA3) {
          console.log('[Offscreen] ✓ Valid WebM header');
        } else {
          console.error('[Offscreen] ✗ Invalid WebM header!');
          throw new Error('Invalid WebM header - recording corrupted');
        }
        
        console.log('[Offscreen] ✓ All validation passed');
        console.log('[Offscreen] Converting to base64...');
        
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

    mediaRecorder.onerror = (event) => {
      console.error('[Offscreen] MediaRecorder error:', event.error);
      reportError('MediaRecorder error: ' + event.error.message);
      cleanup();
    };

    // Start recording
    mediaRecorder.start();
    
    console.log('[Offscreen] ===== RECORDING STARTED =====');
    console.log('[Offscreen] ✓ Desktop video+audio captured');
    console.log('[Offscreen] ✓ Microphone:', micStream ? 'Yes' : 'No');
    console.log('[Offscreen] ✓ Audio monitoring enabled');

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
    mediaRecorder.requestData();
    console.log('[Offscreen] Final data requested');
    
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('[Offscreen] Stopping MediaRecorder...');
        mediaRecorder.stop();
        console.log('[Offscreen] Stop signal sent');
      }
    }, 500);
    
  } catch (error) {
    console.error('[Offscreen] Stop error:', error);
    reportError('Failed to stop recording: ' + error.message);
    cleanup();
  }
}

function cleanup() {
  console.log('[Offscreen] Cleaning up...');
  
  if (desktopStream) {
    desktopStream.getTracks().forEach(track => track.stop());
    desktopStream = null;
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
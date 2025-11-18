/**
 * POAi v2.0 - Offscreen Recording Script
 * FIXED: Properly captures tab content and mixes with microphone
 */

console.log('[Offscreen] Loaded');

let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let tabStream = null;
let micStream = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Offscreen] Message:', request.action);
  
  if (request.action === 'startOffscreenRecording') {
    startRecording()
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('[Offscreen] Start failed:', err);
        reportError(err.message);
        sendResponse({ success: false, error: err.message });
      });
    return true;

  } else if (request.action === 'stopOffscreenRecording') {
    stopRecording();
    sendResponse({ success: true });
    return true;
  }
});

async function startRecording() {
  console.log('[Offscreen] Starting recording...');
  
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    throw new Error('Already recording');
  }
  
  try {
    // FIXED: Get the current tab's capture using getDisplayMedia
    // This will show the native share picker
    console.log('[Offscreen] Requesting display media...');
    tabStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: true
    });
    
    console.log('[Offscreen] Tab stream captured');
    console.log('[Offscreen] Video tracks:', tabStream.getVideoTracks().length);
    console.log('[Offscreen] Audio tracks:', tabStream.getAudioTracks().length);
    
    if (tabStream.getVideoTracks().length === 0) {
      throw new Error('No video track captured');
    }

    // Setup audio mixing
    console.log('[Offscreen] Setting up audio...');
    audioContext = new AudioContext();
    const recordingDest = audioContext.createMediaStreamDestination();
    const monitoringDest = audioContext.destination;
    
    // Tab audio
    if (tabStream.getAudioTracks().length > 0) {
      const tabAudioStream = new MediaStream(tabStream.getAudioTracks());
      const tabAudioSource = audioContext.createMediaStreamSource(tabAudioStream);
      tabAudioSource.connect(recordingDest);
      tabAudioSource.connect(monitoringDest); // Hear tab audio
      console.log('[Offscreen] Tab audio connected');
    }

    // Get microphone
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
      micSource.connect(recordingDest);
      console.log('[Offscreen] Microphone connected');
    } catch (micError) {
      console.warn('[Offscreen] No microphone:', micError.message);
      micStream = null;
    }

    // Create combined stream
    const videoTracks = tabStream.getVideoTracks();
    const audioTracks = recordingDest.stream.getAudioTracks();
    
    const combinedStream = new MediaStream([
      ...videoTracks,
      ...audioTracks
    ]);
    
    console.log('[Offscreen] Combined stream created');
    console.log('[Offscreen] Final video tracks:', combinedStream.getVideoTracks().length);
    console.log('[Offscreen] Final audio tracks:', combinedStream.getAudioTracks().length);

    // Setup MediaRecorder with browser default codec
    recordedChunks = [];
    
    // Use browser's default supported codec
    let mimeType = '';
    const codecs = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    
    for (const codec of codecs) {
      if (MediaRecorder.isTypeSupported(codec)) {
        mimeType = codec;
        break;
      }
    }
    
    if (!mimeType) {
      // Fallback to browser default
      mediaRecorder = new MediaRecorder(combinedStream);
    } else {
      mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2500000
      });
    }
    
    console.log('[Offscreen] MediaRecorder created:', mediaRecorder.mimeType);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('[Offscreen] Chunk:', event.data.size, 'bytes');
      }
    };

    mediaRecorder.onstop = async () => {
      console.log('[Offscreen] Recording stopped');
      console.log('[Offscreen] Total chunks:', recordedChunks.length);
      
      try {
        if (recordedChunks.length === 0) {
          throw new Error('No data recorded');
        }
        
        const totalSize = recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log('[Offscreen] Total size:', totalSize, 'bytes');
        
        if (totalSize < 10000) {
          throw new Error(`Recording too small: ${totalSize} bytes`);
        }
        
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        
        console.log('[Offscreen] Blob created:', videoBlob.size, 'bytes');
        
        if (!videoBlob.type.startsWith('video/')) {
          throw new Error(`Invalid blob type: ${videoBlob.type}`);
        }
        
        // Verify WebM header
        const slice = videoBlob.slice(0, 4);
        const arrayBuffer = await slice.arrayBuffer();
        const arr = new Uint8Array(arrayBuffer);
        
        if (arr[0] === 0x1A && arr[1] === 0x45 && arr[2] === 0xDF && arr[3] === 0xA3) {
          console.log('[Offscreen] ✓ Valid WebM header');
        } else {
          console.warn('[Offscreen] Warning: Unexpected header');
        }
        
        // Convert to base64
        const reader = new FileReader();
        
        reader.onloadend = () => {
          console.log('[Offscreen] Base64 ready, sending to background...');
          
          chrome.runtime.sendMessage({
            action: 'blobReady',
            blobData: reader.result,
            mimeType: videoBlob.type,
            size: videoBlob.size
          }).then(() => {
            console.log('[Offscreen] Sent successfully');
            cleanup();
          }).catch(err => {
            console.error('[Offscreen] Send error:', err);
            reportError('Failed to send recording');
            cleanup();
          });
        };
        
        reader.onerror = () => {
          throw new Error('FileReader failed');
        };
        
        reader.readAsDataURL(videoBlob);
        
      } catch (error) {
        console.error('[Offscreen] Processing error:', error);
        reportError(error.message);
        cleanup();
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error('[Offscreen] MediaRecorder error:', event.error);
      reportError('MediaRecorder error: ' + event.error.message);
    };

    // Start recording
    mediaRecorder.start();
    
    console.log('[Offscreen] ===== RECORDING STARTED =====');
    console.log('[Offscreen] ✓ Video+audio captured');
    console.log('[Offscreen] ✓ Microphone:', micStream ? 'Yes' : 'No');
    console.log('[Offscreen] ✓ Audio monitoring enabled');

  } catch (error) {
    console.error('[Offscreen] Start error:', error);
    cleanup();
    throw error;
  }
}

function stopRecording() {
  console.log('[Offscreen] Stop requested');
  
  if (!mediaRecorder) {
    console.error('[Offscreen] No mediaRecorder');
    return;
  }
  
  if (mediaRecorder.state !== 'recording') {
    console.warn('[Offscreen] Not recording, state:', mediaRecorder.state);
    return;
  }
  
  try {
    console.log('[Offscreen] Requesting final data...');
    mediaRecorder.requestData();
    
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('[Offscreen] Stopping MediaRecorder...');
        mediaRecorder.stop();
      }
    }, 500);
    
  } catch (error) {
    console.error('[Offscreen] Stop error:', error);
    reportError('Failed to stop: ' + error.message);
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
  
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
  
  mediaRecorder = null;
  recordedChunks = [];
  
  console.log('[Offscreen] Cleanup complete');
}

function reportError(errorMessage) {
  console.error('[Offscreen] Reporting error:', errorMessage);
  
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

window.addEventListener('beforeunload', () => {
  console.log('[Offscreen] Unloading');
  cleanup();
});

console.log('[Offscreen] Ready');
// Offscreen Document - Handles Video + Audio Capture with Monitoring
// Critical: User MUST hear the tab audio while recording

let mediaRecorder = null;
let audioChunks = [];
let videoChunks = [];
let audioContext = null;
let combinedStream = null;
let micStream = null;
let tabStream = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startOffscreenRecording') {
    startRecording(request.streamId)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('[Offscreen] Start recording error:', err);
        sendResponse({ success: false, error: err.message });
      });
  } else if (request.action === 'stopOffscreenRecording') {
    stopRecording();
    sendResponse({ success: true });
  }
  return true;
});

async function startRecording(streamId) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.warn('[Offscreen] Recording already in progress.');
    return;
  }
  
  try {
    console.log('[Offscreen] Received streamId:', streamId);
    
    // ==================== STEP 1: Get Tab Video + Audio Stream ====================
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
          maxHeight: 1080
        }
      }
    });
    
    console.log('[Offscreen] Tab stream captured');
    console.log('[Offscreen] Video tracks:', tabStream.getVideoTracks().length);
    console.log('[Offscreen] Audio tracks:', tabStream.getAudioTracks().length);

    // ==================== STEP 2: Get Microphone (Optional) ====================
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      console.log('[Offscreen] Mic stream captured');
    } catch (micError) {
      console.warn('[Offscreen] Microphone access denied or unavailable:', micError);
      micStream = null;
    }

    // ==================== STEP 3: Audio Mixing + Monitoring (CRITICAL) ====================
    audioContext = new AudioContext();
    
    // Create destination for recording
    const recordingDestination = audioContext.createMediaStreamDestination();
    
    // Create destination for user's speakers (MONITORING)
    // This is what allows the user to HEAR the meeting
    const monitoringDestination = audioContext.destination;
    
    // Process Tab Audio
    const tabAudioTracks = tabStream.getAudioTracks();
    if (tabAudioTracks.length > 0) {
      const tabSource = audioContext.createMediaStreamSource(
        new MediaStream(tabAudioTracks)
      );
      
      // Route to BOTH recording AND speakers
      tabSource.connect(recordingDestination);  // For file
      tabSource.connect(monitoringDestination); // For user to hear
      
      console.log('[Offscreen] Tab audio routed to recording AND speakers (monitoring enabled)');
    } else {
      console.warn('[Offscreen] Tab stream has no audio tracks');
      throw new Error('Tab audio stream is empty');
    }

    // Process Microphone Audio (if available)
    if (micStream && micStream.getAudioTracks().length > 0) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      
      // Mic goes to recording only (not to speakers to avoid echo)
      micSource.connect(recordingDestination);
      
      console.log('[Offscreen] Mic audio added to recording');
    } else {
      console.log('[Offscreen] Recording without microphone');
    }

    // ==================== STEP 4: Create Combined Stream ====================
    // Combine video from tab + mixed audio
    const videoTracks = tabStream.getVideoTracks();
    const recordedAudioTracks = recordingDestination.stream.getAudioTracks();
    
    combinedStream = new MediaStream([
      ...videoTracks,
      ...recordedAudioTracks
    ]);
    
    console.log('[Offscreen] Combined stream created');
    console.log('[Offscreen] Final video tracks:', combinedStream.getVideoTracks().length);
    console.log('[Offscreen] Final audio tracks:', combinedStream.getAudioTracks().length);

    // ==================== STEP 5: Start MediaRecorder ====================
    videoChunks = [];
    
    // Choose codec - prefer VP9 for WebM with video
    let mimeType = '';
    const codecs = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    
    for (const codec of codecs) {
      if (MediaRecorder.isTypeSupported(codec)) {
        mimeType = codec;
        console.log('[Offscreen] Using mimeType:', mimeType);
        break;
      }
    }
    
    if (!mimeType) {
      console.warn('[Offscreen] No supported codec found, using browser default');
    }

    const options = {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 2500000 // 2.5 Mbps - good quality for screen recording
    };

    mediaRecorder = new MediaRecorder(combinedStream, options);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        videoChunks.push(event.data);
        console.log('[Offscreen] Data chunk received:', event.data.size, 'bytes');
      }
    };

    mediaRecorder.onstop = () => {
      console.log('[Offscreen] MediaRecorder stopped. Processing video...');
      
      const blobMimeType = mediaRecorder.mimeType || mimeType || 'video/webm';
      const videoBlob = new Blob(videoChunks, { type: blobMimeType });
      
      console.log('[Offscreen] Video blob created:', videoBlob.size, 'bytes, type:', videoBlob.type);
      
      if (videoBlob.size === 0) {
        console.error('[Offscreen] Video blob is empty!');
        cleanup();
        return;
      }
      
      // Convert to base64 for transfer
      const reader = new FileReader();
      reader.onloadend = () => {
        console.log('[Offscreen] Sending video to background script...');
        chrome.runtime.sendMessage({
          action: 'recordingStopped',
          audioBlob: reader.result, // Keep name for backward compatibility
          mimeType: videoBlob.type
        }).catch(err => {
          console.error('[Offscreen] Error sending to background:', err);
        });
      };
      reader.onerror = () => {
        console.error('[Offscreen] FileReader error:', reader.error);
      };
      reader.readAsDataURL(videoBlob);

      cleanup();
    };

    mediaRecorder.onerror = (event) => {
      console.error('[Offscreen] MediaRecorder error:', event.error);
      cleanup();
    };

    // Request data every 10 seconds
    mediaRecorder.start(10000);
    console.log('[Offscreen] Recording started with video + audio monitoring');
    console.log('[Offscreen] User CAN hear the tab audio while recording');

  } catch (error) {
    console.error('[Offscreen] Error starting recording:', error);
    cleanup();
    throw error;
  }
}

function stopRecording() {
  console.log('[Offscreen] Stop recording called');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    console.log('[Offscreen] Stop signal sent to MediaRecorder');
  } else {
    console.warn('[Offscreen] MediaRecorder not in recording state:', mediaRecorder?.state);
  }
}

function cleanup() {
  console.log('[Offscreen] Cleaning up resources...');
  
  // Stop all tracks
  if (tabStream) {
    tabStream.getTracks().forEach(track => {
      track.stop();
      console.log('[Offscreen] Stopped tab track:', track.kind);
    });
    tabStream = null;
  }
  
  if (micStream) {
    micStream.getTracks().forEach(track => {
      track.stop();
      console.log('[Offscreen] Stopped mic track:', track.kind);
    });
    micStream = null;
  }
  
  if (combinedStream) {
    combinedStream.getTracks().forEach(track => {
      track.stop();
      console.log('[Offscreen] Stopped combined track:', track.kind);
    });
    combinedStream = null;
  }
  
  // Close audio context
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().then(() => {
      console.log('[Offscreen] AudioContext closed');
    }).catch(err => {
      console.warn('[Offscreen] Error closing AudioContext:', err);
    });
    audioContext = null;
  }
  
  // Reset recorder
  mediaRecorder = null;
  videoChunks = [];
  
  console.log('[Offscreen] Cleanup complete');
}

// Handle page unload
window.addEventListener('beforeunload', () => {
  console.log('[Offscreen] Page unloading, cleaning up...');
  cleanup();
});
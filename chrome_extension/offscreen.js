/**
 * POAi v2.0 - Offscreen Recording Script
 * 
 * CRITICAL FIXES:
 * 1. Proper recorder.onstop handling (prevents file corruption)
 * 2. Video + Audio capture (not just audio)
 * 3. Audio monitoring (user can hear tab audio)
 */

let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let combinedStream = null;
let micStream = null;
let tabStream = null;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startOffscreenRecording') {
    startRecording(request.streamId)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('[Offscreen] Start recording error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep port open for async response

  } else if (request.action === 'stopOffscreenRecording') {
    // CRITICAL FIX: Only send stop signal, don't upload yet
    stopRecording();
    sendResponse({ success: true });
    return true;
  }
});

async function startRecording(streamId) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.warn('[Offscreen] Recording already in progress');
    return;
  }
  
  try {
    console.log('[Offscreen] Starting recording with streamId:', streamId);
    
    // ==================== STEP 1: Capture Tab Video + Audio ====================
    console.log('[Offscreen] Requesting tab capture...');
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

    // ==================== STEP 2: Audio Monitoring Setup ====================
    // CRITICAL FIX: User must hear the tab audio
    audioContext = new AudioContext();
    
    // Create two destinations
    const recordingDestination = audioContext.createMediaStreamDestination();
    const monitoringDestination = audioContext.destination; // User's speakers!
    
    // Get tab audio tracks
    const tabAudioTracks = tabStream.getAudioTracks();
    if (tabAudioTracks.length === 0) {
      throw new Error('No audio track found in tab stream');
    }
    
    // Create source from tab audio
    const tabAudioStream = new MediaStream(tabAudioTracks);
    const tabAudioSource = audioContext.createMediaStreamSource(tabAudioStream);
    
    // Route audio to BOTH recording AND speakers
    tabAudioSource.connect(recordingDestination);  // For file
    tabAudioSource.connect(monitoringDestination); // For user to hear
    
    console.log('[Offscreen] Audio monitoring enabled - user can hear tab audio');

    // ==================== STEP 3: Microphone (Optional) ====================
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      
      console.log('[Offscreen] Microphone captured');
      
      // Add mic to recording only (not to speakers to avoid echo)
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(recordingDestination);
      
    } catch (micError) {
      console.warn('[Offscreen] Microphone unavailable:', micError.message);
      micStream = null;
    }

    // ==================== STEP 4: Create Combined Stream ====================
    // Combine video from tab + mixed audio
    const videoTracks = tabStream.getVideoTracks();
    const mixedAudioTracks = recordingDestination.stream.getAudioTracks();
    
    combinedStream = new MediaStream([
      ...videoTracks,
      ...mixedAudioTracks
    ]);
    
    console.log('[Offscreen] Combined stream created');
    console.log('[Offscreen] Final video tracks:', combinedStream.getVideoTracks().length);
    console.log('[Offscreen] Final audio tracks:', combinedStream.getAudioTracks().length);

    // ==================== STEP 5: MediaRecorder Setup ====================
    recordedChunks = [];
    
    // Choose codec
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
    
    console.log('[Offscreen] Using mimeType:', mimeType || 'default');

    mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 2500000 // 2.5 Mbps
    });

    // ==================== CRITICAL FIX: Proper onstop Handler ====================
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('[Offscreen] Chunk received:', event.data.size, 'bytes');
      }
    };

    mediaRecorder.onstop = () => {
      console.log('[Offscreen] MediaRecorder stopped');
      console.log('[Offscreen] Total chunks:', recordedChunks.length);
      
      // CRITICAL FIX: Only process blob AFTER recorder has fully stopped
      try {
        // Create final blob
        const blobMimeType = mediaRecorder.mimeType || mimeType || 'video/webm';
        const videoBlob = new Blob(recordedChunks, { type: blobMimeType });
        
        console.log('[Offscreen] Video blob created');
        console.log('[Offscreen] Size:', videoBlob.size, 'bytes');
        console.log('[Offscreen] Type:', videoBlob.type);
        
        if (videoBlob.size === 0) {
          console.error('[Offscreen] ERROR: Blob is empty!');
          cleanup();
          return;
        }
        
        // Convert to base64 for transfer
        const reader = new FileReader();
        
        reader.onloadend = () => {
          console.log('[Offscreen] Blob converted to base64');
          console.log('[Offscreen] Sending blob-ready message to background');
          
          // CRITICAL FIX: Send blob-ready message with complete data
          chrome.runtime.sendMessage({
            action: 'blobReady',  // New action name
            blobData: reader.result,
            mimeType: videoBlob.type,
            size: videoBlob.size
          }).then(() => {
            console.log('[Offscreen] Blob sent successfully');
            cleanup();
          }).catch(err => {
            console.error('[Offscreen] Error sending blob:', err);
            cleanup();
          });
        };
        
        reader.onerror = () => {
          console.error('[Offscreen] FileReader error:', reader.error);
          cleanup();
        };
        
        reader.readAsDataURL(videoBlob);
        
      } catch (error) {
        console.error('[Offscreen] Error processing blob:', error);
        cleanup();
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error('[Offscreen] MediaRecorder error:', event.error);
      cleanup();
    };

    // Start recording with timeslice
    mediaRecorder.start(10000); // 10 second chunks
    console.log('[Offscreen] Recording started');
    console.log('[Offscreen] ✓ User can hear tab audio');
    console.log('[Offscreen] ✓ Video + audio being recorded');

  } catch (error) {
    console.error('[Offscreen] Error starting recording:', error);
    cleanup();
    throw error;
  }
}

function stopRecording() {
  console.log('[Offscreen] Stop recording called');
  
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log('[Offscreen] Stopping MediaRecorder...');
    // This will trigger onstop handler
    mediaRecorder.stop();
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
  
  // Reset state
  mediaRecorder = null;
  recordedChunks = [];
  
  console.log('[Offscreen] Cleanup complete');
}

// Handle page unload
window.addEventListener('beforeunload', () => {
  console.log('[Offscreen] Page unloading, cleaning up...');
  cleanup();
});
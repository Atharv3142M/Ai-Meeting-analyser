// This script runs in the hidden offscreen document.
// Its only job is to receive a stream, record it, and send back the blob.

let mediaRecorder = null;
let audioChunks = [];
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
  return true; // Keep message port open for async response
});

async function startRecording(streamId) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.warn('[Offscreen] Recording already in progress.');
    return;
  }
  
  try {
    console.log('[Offscreen] Received streamId:', streamId);
    
    // 1. Get the Tab Audio Stream (from the streamId)
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false
    });
    console.log('[Offscreen] Tab stream captured. Tracks:', tabStream.getAudioTracks().length);

    // 2. Get the Microphone Audio Stream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      console.log('[Offscreen] Mic stream captured. Tracks:', micStream.getAudioTracks().length);
    } catch (micError) {
      console.warn('[Offscreen] Microphone access denied or unavailable:', micError);
      // Continue without mic - record only tab audio
      micStream = null;
    }

    // 3. Mix the streams using Web Audio API
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    // Add Tab Stream
    if (tabStream.getAudioTracks().length > 0) {
      const tabSource = audioContext.createMediaStreamSource(tabStream);
      tabSource.connect(destination);
      console.log('[Offscreen] Tab audio track added to mixer.');
    } else {
      console.warn('[Offscreen] Tab stream has no audio tracks.');
      throw new Error('Tab audio stream is empty. Please ensure the tab has audio.');
    }

    // Add Mic Stream (if available)
    if (micStream && micStream.getAudioTracks().length > 0) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
      console.log('[Offscreen] Mic audio track added to mixer.');
    } else {
      console.log('[Offscreen] Recording without microphone.');
    }

    combinedStream = destination.stream;

    // 4. Start MediaRecorder with proper codec selection
    audioChunks = [];
    
    // Try codecs in order of preference
    let mimeType = '';
    const codecs = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/ogg'
    ];
    
    for (const codec of codecs) {
      if (MediaRecorder.isTypeSupported(codec)) {
        mimeType = codec;
        console.log('[Offscreen] Using mimeType:', mimeType);
        break;
      }
    }
    
    if (!mimeType) {
      console.warn('[Offscreen] No supported codec found, using browser default.');
    }

    const options = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(combinedStream, options);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
        console.log('[Offscreen] Data chunk received:', event.data.size, 'bytes');
      }
    };

    mediaRecorder.onstop = () => {
      console.log('[Offscreen] MediaRecorder stopped. Processing audio...');
      
      // Get the actual mimeType from the recorder
      const blobMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunks, { type: blobMimeType });
      
      console.log('[Offscreen] Blob created:', audioBlob.size, 'bytes, type:', audioBlob.type);
      
      if (audioBlob.size === 0) {
        console.error('[Offscreen] Audio blob is empty!');
        cleanup();
        return;
      }
      
      // Convert to base64 data URL to send to background script
      const reader = new FileReader();
      reader.onloadend = () => {
        console.log('[Offscreen] Sending audio to background script...');
        // Send the audio data AND the mimeType
        chrome.runtime.sendMessage({
          action: 'recordingStopped',
          audioBlob: reader.result,
          mimeType: audioBlob.type
        }).catch(err => {
          console.error('[Offscreen] Error sending to background:', err);
        });
      };
      reader.onerror = () => {
        console.error('[Offscreen] FileReader error:', reader.error);
      };
      reader.readAsDataURL(audioBlob);

      // Cleanup
      cleanup();
    };

    mediaRecorder.onerror = (event) => {
      console.error('[Offscreen] MediaRecorder error:', event.error);
      cleanup();
    };

    // Request data every 10 seconds to avoid memory issues
    mediaRecorder.start(10000);
    console.log('[Offscreen] Recording started with timeslice: 10000ms');

  } catch (error) {
    console.error('[Offscreen] Error starting recording:', error);
    cleanup();
    throw error;
  }
}

function stopRecording() {
  console.log('[Offscreen] Stop recording called.');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    console.log('[Offscreen] Stop signal sent to MediaRecorder.');
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
      console.log('[Offscreen] AudioContext closed.');
    }).catch(err => {
      console.warn('[Offscreen] Error closing AudioContext:', err);
    });
    audioContext = null;
  }
  
  // Reset recorder
  mediaRecorder = null;
  audioChunks = [];
  
  console.log('[Offscreen] Cleanup complete.');
}

// Handle page unload
window.addEventListener('beforeunload', () => {
  console.log('[Offscreen] Page unloading, cleaning up...');
  cleanup();
});
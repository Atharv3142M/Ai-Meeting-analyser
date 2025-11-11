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
      .catch(err => sendResponse({ success: false, error: err.message }));
  } else if (request.action === 'stopOffscreenRecording') {
    stopRecording();
    sendResponse({ success: true });
  }
  return true; // Keep message port open for async response
});

async function startRecording(streamId) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.warn('Recording already in progress.');
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
    console.log('[Offscreen] Tab stream captured. Tracks:', tabStream.getAudioTracks());

    // 2. Get the Microphone Audio Stream
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    });
    console.log('[Offscreen] Mic stream captured. Tracks:', micStream.getAudioTracks());

    // 3. Mix the streams
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    // Add Tab Stream
    if (tabStream.getAudioTracks().length > 0) {
      const tabSource = audioContext.createMediaStreamSource(tabStream);
      tabSource.connect(destination);
      console.log('[Offscreen] Tab audio track added to mixer.');
    } else {
      console.warn('[Offscreen] Tab stream has no audio tracks.');
    }

    // Add Mic Stream
    if (micStream.getAudioTracks().length > 0) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
      console.log('[Offscreen] Mic audio track added to mixer.');
    } else {
      console.warn('[Offscreen] Mic stream has no audio tracks.');
    }

    combinedStream = destination.stream;

    // 4. Start MediaRecorder
    audioChunks = [];
    
    // Choose a reliable mimeType
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      console.warn('[Offscreen] audio/webm;codecs=opus not supported. Falling back.');
      mimeType = 'audio/ogg;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        console.warn('[Offscreen] audio/ogg;codecs=opus not supported. Falling back to default.');
        mimeType = ''; // Let browser decide
      }
    }
    console.log('[Offscreen] Using mimeType:', mimeType || 'browser default');

    mediaRecorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      // *** THIS IS THE CRITICAL BUG FIX ***
      // The variable was 'blobMimeType' but was misspelled in your file.
      const blobMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunks, { type: blobMimeType });
      // *** END OF FIX ***

      console.log('[Offscreen] Blob created:', audioBlob.size, audioBlob.type);
      
      // Convert to base64 data URL to send to background script
      const reader = new FileReader();
      reader.onloadend = () => {
        // Send the audio data AND the mimeType
        chrome.runtime.sendMessage({
          action: 'recordingStopped',
          audioBlob: reader.result,
          mimeType: audioBlob.type
        });
      };
      reader.readAsDataURL(audioBlob);

      // Cleanup
      cleanup();
    };

    mediaRecorder.start();
    console.log('[Offscreen] Recording started.');

  } catch (error) {
    console.error('Error starting offscreen recording:', error);
    cleanup();
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    console.log('[Offscreen] Stop signal sent.');
  }
}

function cleanup() {
  console.log('[Offscreen] Cleaning up resources...');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // onstop will handle the rest of the cleanup
    mediaRecorder.stop();
  } else {
    // If we're cleaning up from an error *before* stopping
    audioChunks = [];
    mediaRecorder = null;
    
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
    console.log('[Offscreen] Cleanup complete.');
  }
}
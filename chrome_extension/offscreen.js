// This script runs in the hidden offscreen document.
// Its only job is to receive a stream, record it, and send back the blob.

let mediaRecorder = null;
let audioChunks = [];
let audioContext = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startOffscreenRecording') {
    startRecording(request.streamId, request.tabId);
    sendResponse({ success: true });
  } else if (request.action === 'stopOffscreenRecording') {
    stopRecording();
    sendResponse({ success: true });
  }
  return true;
});

async function startRecording(streamId, tabId) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.warn('Recording already in progress.');
    return;
  }
  
  try {
    // 1. Get the Tab Audio Stream (from the streamId)
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false
    });

    // 2. Get the Microphone Audio Stream
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    });

    // 3. Mix the streams
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    // Add Tab Stream
    if (tabStream.getAudioTracks().length > 0) {
      const tabSource = audioContext.createMediaStreamSource(tabStream);
      tabSource.connect(destination);
    }

    // Add Mic Stream
    if (micStream.getAudioTracks().length > 0) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
    }

    const combinedStream = destination.stream;

    // 4. Start MediaRecorder
    audioChunks = [];
    
    // Choose a reliable mimeType
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/ogg;codecs=opus';
    }
    console.log('[Offscreen] Using mimeType:', mimeType);

    mediaRecorder = new MediaRecorder(combinedStream, { mimeType });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: mimeType });
      
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
      audioChunks = [];
      mediaRecorder = null;
      audioContext.close();
      tabStream.getTracks().forEach(track => track.stop());
      micStream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    console.log('[Offscreen] Recording started.');

  } catch (error) {
    console.error('Error starting offscreen recording:', error);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    console.log('[Offscreen] Recording stopped.');
  }
}
// Script injetado na página para capturar áudio
// This script runs in the context of the web page, not the service worker

let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let tabStream = null;
let combinedStream = null;
let audioContext = null;

// Listener for messages from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCapture') {
    startCapture()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Indicates async response
  } else if (request.action === 'stopCapture') {
    stopCapture()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Indicates async response
  }
});

async function startCapture() {
  try {
    console.log('[Recorder] Initiating audio capture...');
    
    // 1. Capture microphone
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        console.log('[Recorder] Microphone captured.');
    } catch (micError) {
        console.error('[Recorder] Microphone capture failed:', micError);
        throw new Error('Microphone permission denied.');
    }

    // 2. Capture tab audio
    try {
      tabStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: false, // Don't need video
        audio: {
          // These constraints are for system/tab audio
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      console.log('[Recorder] Tab audio captured.');
    } catch (tabError) {
      console.warn('[Recorder] Tab audio capture failed (maybe no audio on tab?):', tabError.message);
      // We don't throw an error here, we can proceed with mic-only.
      tabStream = null;
    }

    // 3. Combine streams
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    // Add Mic Stream
    if (micStream) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(destination);
    }

    // Add Tab Stream (if captured)
    if (tabStream && tabStream.getAudioTracks().length > 0) {
        const tabSource = audioContext.createMediaStreamSource(tabStream);
        tabSource.connect(destination);
    } else {
        console.log('[Recorder] No tab audio track found. Proceeding with mic-only.');
    }
    
    combinedStream = destination.stream;
    console.log('[Recorder] Streams combined.');
    
    // 4. Start recording
    audioChunks = [];
    
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
    }
    
    console.log('[Recorder] Using mimeType:', mimeType || 'browser default');
    
    mediaRecorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      console.log('[Recorder] Recording stopped, creating blob...');
      
      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
      
      console.log('[Recorder] Blob created:', {
        size: audioBlob.size,
        type: audioBlob.type
      });
      
      // Convert to base64 data URL to send to background script
      const reader = new FileReader();
      reader.onloadend = () => {
        // Send the audio data to the background script
        chrome.runtime.sendMessage({
          action: 'recordingStopped',
          audioBlob: reader.result // Send as base64
        });
      };
      reader.readAsDataURL(audioBlob);
      
      cleanup(); // Clean up streams
    };

    mediaRecorder.onerror = (event) => {
      console.error('[Recorder] MediaRecorder error:', event.error);
      cleanup();
    };

    mediaRecorder.start(1000); // chunk every second
    console.log('[Recorder] MediaRecorder started.');

  } catch (error) {
    console.error('[Recorder] Error in startCapture:', error);
    cleanup(); // Clean up any streams that were opened
    throw error;
  }
}

async function stopCapture() {
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop(); // This will trigger the 'onstop' event
      console.log('[Recorder] Stop signal sent to MediaRecorder.');
    }
  } catch (error) {
    console.error('[Recorder] Error in stopCapture:', error);
    cleanup();
    throw error;
  }
}

function cleanup() {
  console.log('[Recorder] Cleaning up resources...');
  
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  
  if (tabStream) {
    tabStream.getTracks().forEach(track => track.stop());
    tabStream = null;
  }

  if (combinedStream) {
    combinedStream.getTracks().forEach(track => track.stop());
    combinedStream = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
  
  audioChunks = [];
  mediaRecorder = null;
}
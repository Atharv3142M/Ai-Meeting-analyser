/**
 * POAi v2.0 - Offscreen Recording Script
 * 
 * This script runs in a hidden offscreen document and handles:
 * 1. Capturing tab video + audio via tabCapture stream
 * 2. Capturing microphone audio
 * 3. Mixing tab audio and mic audio
 * 4. Routing audio to speakers (monitoring)
 * 5. Recording everything with MediaRecorder
 * 6. Safely packaging the final video blob
 */

console.log('[Offscreen] POAi v2.0 offscreen script loaded');

let mediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let combinedStream = null;
let micStream = null;
let tabStream = null;

// ==================== Message Listener ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Offscreen] Received message:', request.action);
  
  if (request.action === 'startOffscreenRecording') {
    startRecording(request.streamId)
      .then(() => {
        console.log('[Offscreen] Recording started successfully');
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[Offscreen] Failed to start recording:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep port open for async response

  } else if (request.action === 'stopOffscreenRecording') {
    console.log('[Offscreen] Stop recording requested');
    stopRecording();
    sendResponse({ success: true });
    return true;
  }
});

// ==================== Recording Functions ====================

async function startRecording(streamId) {
  console.log('[Offscreen] startRecording called with streamId:', streamId);
  
  // Check if already recording
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.warn('[Offscreen] Already recording');
    return;
  }
  
  try {
    // ==================== STEP 1: Capture Tab Video + Audio ====================
    console.log('[Offscreen] Step 1: Capturing tab stream...');
    
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
    
    console.log('[Offscreen] Tab stream captured');
    console.log('[Offscreen] Video tracks:', tabStream.getVideoTracks().length);
    console.log('[Offscreen] Audio tracks:', tabStream.getAudioTracks().length);
    
    // Validate tab stream
    if (tabStream.getVideoTracks().length === 0) {
      throw new Error('No video track in tab stream');
    }
    if (tabStream.getAudioTracks().length === 0) {
      throw new Error('No audio track in tab stream');
    }

    // ==================== STEP 2: Setup Audio Context for Mixing + Monitoring ====================
    console.log('[Offscreen] Step 2: Setting up audio context...');
    
    audioContext = new AudioContext();
    
    // Create two destinations
    const recordingDestination = audioContext.createMediaStreamDestination();
    const monitoringDestination = audioContext.destination; // User's speakers!
    
    console.log('[Offscreen] Audio context created');
    
    // ==================== STEP 3: Process Tab Audio ====================
    console.log('[Offscreen] Step 3: Processing tab audio...');
    
    const tabAudioTracks = tabStream.getAudioTracks();
    const tabAudioStream = new MediaStream(tabAudioTracks);
    const tabAudioSource = audioContext.createMediaStreamSource(tabAudioStream);
    
    // Route tab audio to BOTH destinations
    tabAudioSource.connect(recordingDestination);  // For recording
    tabAudioSource.connect(monitoringDestination); // For user to hear
    
    console.log('[Offscreen] Tab audio routed to recording AND speakers');

    // ==================== STEP 4: Capture Microphone (Optional) ====================
    console.log('[Offscreen] Step 4: Attempting to capture microphone...');
    
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
      
      console.log('[Offscreen] Microphone audio added to recording');
      
    } catch (micError) {
      console.warn('[Offscreen] Microphone not available:', micError.message);
      console.log('[Offscreen] Continuing without microphone');
      micStream = null;
    }

    // ==================== STEP 5: Create Combined Stream ====================
    console.log('[Offscreen] Step 5: Creating combined stream...');
    
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

    // ==================== STEP 6: Setup MediaRecorder ====================
    console.log('[Offscreen] Step 6: Setting up MediaRecorder...');
    
    recordedChunks = [];
    
    // CRITICAL: Let browser choose codec (most robust approach)
    console.log('[Offscreen] Using browser default codec for maximum stability');
    
    mediaRecorder = new MediaRecorder(combinedStream);
    
    console.log('[Offscreen] MediaRecorder created');
    console.log('[Offscreen] MIME type:', mediaRecorder.mimeType);

    // ==================== STEP 7: Setup Event Handlers ====================
    console.log('[Offscreen] Step 7: Setting up event handlers...');
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('[Offscreen] Data chunk:', event.data.size, 'bytes');
      }
    };

    mediaRecorder.onstop = () => {
      console.log('[Offscreen] ==================== RECORDING STOPPED ====================');
      console.log('[Offscreen] Total chunks collected:', recordedChunks.length);
      
      // CRITICAL VALIDATION: Check if we have any data
      if (recordedChunks.length === 0) {
        console.error('[Offscreen] CRITICAL ERROR: No chunks recorded!');
        console.error('[Offscreen] This indicates MediaRecorder never collected data');
        cleanup();
        
        chrome.runtime.sendMessage({
          action: 'recordingError',
          error: 'No data recorded. Please try again.'
        });
        return;
      }
      
      try {
        // Calculate total size first
        let totalSize = 0;
        for (let chunk of recordedChunks) {
          totalSize += chunk.size;
        }
        
        console.log('[Offscreen] Total data size:', totalSize, 'bytes');
        
        if (totalSize === 0) {
          console.error('[Offscreen] CRITICAL ERROR: Total size is 0!');
          cleanup();
          return;
        }
        
        // Create final blob
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        const videoBlob = new Blob(recordedChunks, { type: mimeType });
        
        console.log('[Offscreen] Video blob created');
        console.log('[Offscreen] Blob size:', videoBlob.size, 'bytes');
        console.log('[Offscreen] Blob type:', videoBlob.type);
        
        // CRITICAL VALIDATION: Verify blob size matches
        if (videoBlob.size !== totalSize) {
          console.error('[Offscreen] WARNING: Blob size mismatch!');
          console.error('[Offscreen] Expected:', totalSize, 'Got:', videoBlob.size);
        }
        
        // Final validation
        if (videoBlob.size === 0) {
          console.error('[Offscreen] CRITICAL ERROR: Final blob is empty!');
          cleanup();
          return;
        }
        
        if (videoBlob.size < 10000) { // Less than 10KB is suspicious
          console.error('[Offscreen] CRITICAL ERROR: Blob too small:', videoBlob.size, 'bytes');
          console.error('[Offscreen] Likely corrupted or incomplete recording');
          cleanup();
          return;
        }
        
        console.log('[Offscreen] ✓ Blob validation passed');
        console.log('[Offscreen] Converting to base64...');
        
        // Convert to base64 for transfer
        const reader = new FileReader();
        
        reader.onloadend = () => {
          console.log('[Offscreen] ✓ Blob converted to base64');
          console.log('[Offscreen] Base64 length:', reader.result.length, 'characters');
          console.log('[Offscreen] Sending blobReady message to background...');
          
          // Send to background script
          chrome.runtime.sendMessage({
            action: 'blobReady',
            blobData: reader.result,
            mimeType: videoBlob.type,
            size: videoBlob.size
          }).then(() => {
            console.log('[Offscreen] ✓ Blob sent successfully to background');
            cleanup();
          }).catch(err => {
            console.error('[Offscreen] ERROR sending blob to background:', err);
            cleanup();
          });
        };
        
        reader.onerror = () => {
          console.error('[Offscreen] FileReader error:', reader.error);
          cleanup();
        };
        
        reader.readAsDataURL(videoBlob);
        
      } catch (error) {
        console.error('[Offscreen] Error in onstop handler:', error);
        console.error('[Offscreen] Error stack:', error.stack);
        cleanup();
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error('[Offscreen] MediaRecorder error:', event.error);
      cleanup();
    };

    // ==================== STEP 8: Start Recording ====================
    console.log('[Offscreen] Step 8: Starting recording...');
    
    // CRITICAL FIX: Start WITHOUT timeslice for complete blob
    // Using timeslice can cause incomplete final chunk
    mediaRecorder.start();
    
    console.log('[Offscreen] ==================== RECORDING STARTED ====================');
    console.log('[Offscreen] ✓ Tab video captured');
    console.log('[Offscreen] ✓ Tab audio captured');
    console.log('[Offscreen] ✓ User can hear tab audio (monitoring enabled)');
    console.log('[Offscreen] ✓ Microphone:', micStream ? 'captured' : 'not available');
    console.log('[Offscreen] Recording state:', mediaRecorder.state);
    console.log('[Offscreen] IMPORTANT: Recording without timeslice for complete blob');

  } catch (error) {
    console.error('[Offscreen] Error in startRecording:', error);
    cleanup();
    throw error;
  }
}

function stopRecording() {
  console.log('[Offscreen] stopRecording called');
  
  if (!mediaRecorder) {
    console.error('[Offscreen] MediaRecorder is null');
    return;
  }
  
  if (mediaRecorder.state !== 'recording') {
    console.warn('[Offscreen] MediaRecorder not recording, state:', mediaRecorder.state);
    return;
  }
  
  console.log('[Offscreen] Stopping MediaRecorder...');
  console.log('[Offscreen] Current state:', mediaRecorder.state);
  console.log('[Offscreen] Current chunks collected:', recordedChunks.length);
  
  // CRITICAL: Request final data before stopping
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.requestData();
    console.log('[Offscreen] Final data requested');
    
    // Give time for final chunk, then stop
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        console.log('[Offscreen] Stop signal sent after delay');
      }
    }, 500); // 500ms delay ensures all data is collected
  }
}

function cleanup() {
  console.log('[Offscreen] cleanup called');
  console.log('[Offscreen] Cleaning up all resources...');
  
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

// ==================== Page Lifecycle ====================

window.addEventListener('beforeunload', () => {
  console.log('[Offscreen] Page unloading, cleaning up...');
  cleanup();
});

console.log('[Offscreen] Ready to record');
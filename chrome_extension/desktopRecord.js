const convertBlobToBase64 = (blob) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = reader.result;
      resolve(base64data);
    };
  });
};

const fetchBlob = async (url) => {
  const response = await fetch(url);
  const blob = await response.blob();
  const base64 = await convertBlobToBase64(blob);
  return base64;
};

// listen for messages from the service worker
chrome.runtime.onMessage.addListener(function (request, sender) {
  console.log("message received", request, sender);

  switch (request.type) {
    case "start-recording":
      startRecording(request.focusedTabId);
      break;
    case "stop-recording":
      stopRecording();
      break;
    default:
      console.log("default");
  }

  return true;
});

let recorder;
let data = [];

const stopRecording = () => {
  console.log("stop recording");
  if (recorder?.state === "recording") {
    recorder.stop();
    // stop all streams
    recorder.stream.getTracks().forEach((t) => t.stop());
  }
};

const startRecording = async (focusedTabId) => {
  // use desktopCapture to get the screen stream
  chrome.desktopCapture.chooseDesktopMedia(
    ["screen", "window", "tab", "audio"], // Explicitly ask for audio
    async function (streamId) {
      if (!streamId) {
        return; // User cancelled
      }
      console.log("stream id from desktop capture", streamId);

      // 1. Get the System Audio & Video
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: streamId,
          },
        },
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: streamId,
          },
        },
      });

      // 2. Get the Microphone Audio
      // We use a separate getUserMedia call for this
      let microphoneStream;
      try {
          microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false },
          });
      } catch (e) {
          console.warn("Microphone access denied or unavailable", e);
      }

      // 3. Combine them
      let combinedStream;
      
      if (microphoneStream && microphoneStream.getAudioTracks().length > 0) {
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();

        // Add system audio if available
        if (stream.getAudioTracks().length > 0) {
            const systemSource = audioContext.createMediaStreamSource(stream);
            systemSource.connect(destination);
        }

        // Add mic audio
        const micSource = audioContext.createMediaStreamSource(microphoneStream);
        micSource.connect(destination);

        combinedStream = new MediaStream([
          stream.getVideoTracks()[0],
          destination.stream.getAudioTracks()[0],
        ]);
      } else {
          // Fallback if no mic: just use system stream
          combinedStream = stream;
      }

      recorder = new MediaRecorder(combinedStream, {
        mimeType: "video/webm",
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            data.push(event.data);
        }
      };

      recorder.onstop = async () => {
        console.log("recording stopped");
        const blobFile = new Blob(data, { type: "video/webm" });
        
        // Validate blob size (Fixes 0-byte corruption)
        if (blobFile.size === 0) {
            console.error("Recording failed: 0 byte file");
            return;
        }

        const url = URL.createObjectURL(blobFile);
        const base64 = await fetchBlob(url);

        chrome.runtime.sendMessage({ 
          type: "open-tab", 
          url: url,
          base64: base64 
        });

        data = [];
      };

      recorder.start();

      if (focusedTabId) {
        chrome.tabs.update(focusedTabId, { active: true });
      }
    }
  );
};
let currentAudio = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PLAY_ELEVENLABS_AUDIO') {
    playAudio(message.base64Audio);
  } else if (message.type === 'STOP_ELEVENLABS_AUDIO') {
    stopAudio();
  }
});

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  // Use stopped:true so background knows not to fall back to Chrome TTS
  chrome.runtime.sendMessage({ type: 'ELEVENLABS_PLAYBACK_DONE', success: false, stopped: true });
}

async function playAudio(base64Audio) {
  // Stop any audio already playing
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }

  try {
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    await new Promise((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) {
          currentAudio = null;
          chrome.runtime.sendMessage({ type: 'ELEVENLABS_PLAYBACK_DONE', success: true });
        }
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) {
          currentAudio = null;
          chrome.runtime.sendMessage({ type: 'ELEVENLABS_PLAYBACK_DONE', success: false });
        }
        resolve();
      };
      audio.play().catch(() => {
        if (currentAudio === audio) {
          currentAudio = null;
          chrome.runtime.sendMessage({ type: 'ELEVENLABS_PLAYBACK_DONE', success: false });
        }
        resolve();
      });
    });
  } catch (error) {
    console.error('Offscreen audio playback failed:', error);
    currentAudio = null;
    chrome.runtime.sendMessage({ type: 'ELEVENLABS_PLAYBACK_DONE', success: false });
  }
}

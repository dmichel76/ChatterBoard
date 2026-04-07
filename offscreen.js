chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PLAY_ELEVENLABS_AUDIO') {
    playAudio(message.base64Audio);
  }
});

async function playAudio(base64Audio) {
  try {
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    await new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      audio.play().catch(reject);
    });

    chrome.runtime.sendMessage({ type: 'ELEVENLABS_PLAYBACK_DONE', success: true });
  } catch (error) {
    console.error('Offscreen audio playback failed:', error);
    chrome.runtime.sendMessage({ type: 'ELEVENLABS_PLAYBACK_DONE', success: false });
  }
}

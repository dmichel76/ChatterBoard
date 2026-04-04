chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'RUN_CHATTERBOARD') {
    const tabId = message.tabId;

    if (!tabId) {
      sendResponse({ ok: false, error: 'No tabId provided' });
      return true;
    }

    chrome.storage.sync.get(['adoPat'], (stored) => {
      const adoPat = (stored.adoPat || '').trim();

      if (!adoPat) {
        sendResponse({ ok: false, error: 'No Azure DevOps PAT found in Options.' });
        return;
      }

      chrome.tts.stop();

      chrome.tts.speak(
        'PAT found. ChatterBoard is ready.',
        {
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          onEvent: (event) => {
            if (event.type === 'end') {
              sendResponse({ ok: true, count: 1 });
            } else if (event.type === 'error' || event.type === 'interrupted' || event.type === 'cancelled') {
              sendResponse({ ok: false, error: `TTS failed: ${event.type}` });
            }
          }
        }
      );
    });

    return true;
  }

  return false;
});
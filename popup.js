const statusEl = document.getElementById('status');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const nowReadingPanelEl = document.getElementById('nowReadingPanel');
const currentTicketIdEl = document.getElementById('currentTicketId');
const currentTicketTitleEl = document.getElementById('currentTicketTitle');
const currentTicketReasonEl = document.getElementById('currentTicketReason');

function setStatus(message) {
  statusEl.textContent = message;
}

function setCurrentTicket(ticket) {
  currentTicketIdEl.textContent = ticket?.id ?? '-';
  currentTicketTitleEl.textContent = ticket?.title ?? '-';
  currentTicketReasonEl.textContent = ticket?.reason ?? '-';

  if (ticket) {
    nowReadingPanelEl.classList.remove('hidden');
  } else {
    nowReadingPanelEl.classList.add('hidden');
  }
}

function applyState(state) {
  if (!state) return;

  setStatus(state.statusMessage || 'Idle.');
  setCurrentTicket(state.currentTicket || null);

  playButton.disabled = !!state.isRunning;
  stopButton.disabled = !state.isRunning;
}

async function loadState() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_CHATTERBOARD_STATE'
    });

    if (response?.ok) {
      applyState(response.state);
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'CHATTERBOARD_STATE') {
    applyState(message.state);
  }
});

playButton.addEventListener('click', async () => {
  try {
    setStatus('Running...');
    setCurrentTicket(null);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      setStatus('No active tab found.');
      return;
    }

    if (!/dev\.azure\.com|visualstudio\.com/.test(tab.url)) {
      setStatus('Open an Azure DevOps page first.');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'RUN_CHATTERBOARD',
      tabId: tab.id,
      url: tab.url
    });

    if (!response?.ok) {
      setStatus(response?.error || 'Unknown error.');
      return;
    }

    if (response.stopped) {
      setStatus('Stopped.');
      return;
    }

    setStatus(`Done. Spoke ${response.count} ticket(s).`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadState();
  }
});

stopButton.addEventListener('click', async () => {
  try {
    setStatus('Stopping...');
    const response = await chrome.runtime.sendMessage({
      type: 'STOP_CHATTERBOARD'
    });

    if (!response?.ok) {
      setStatus(response?.error || 'Could not stop ChatterBoard.');
      return;
    }

    setStatus('Stopped.');
    setCurrentTicket(null);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadState();
  }
});

loadState();
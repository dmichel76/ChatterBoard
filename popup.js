const statusEl = document.getElementById('status');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const nowReadingPanelEl = document.getElementById('nowReadingPanel');
const frustrationScoreEl = document.getElementById('frustrationScore');
const currentTicketIdEl = document.getElementById('currentTicketId');
const currentTicketTitleEl = document.getElementById('currentTicketTitle');
const currentTicketReasonEl = document.getElementById('currentTicketReason');
const lastUpdatedRawValueEl = document.getElementById('lastUpdatedRawValue');
const lastUpdatedSignalFillEl = document.getElementById('lastUpdatedSignalFill');

function setStatus(message) {
  statusEl.textContent = message;
}

function getScoreColour(score) {
  const clampedScore = Math.max(0, Math.min(100, Number(score) || 0));

  if (clampedScore <= 50) {
    const ratio = clampedScore / 50;
    const red = Math.round(46 + ((245 - 46) * ratio));
    const green = Math.round(204 + ((158 - 204) * ratio));
    return `rgb(${red}, ${green}, 113)`;
  }

  const ratio = (clampedScore - 50) / 50;
  const red = 245;
  const green = Math.round(158 + ((63 - 158) * ratio));
  return `rgb(${red}, ${green}, 63)`;
}

function setSignalBar(fillEl, score) {
  const clampedScore = Math.max(0, Math.min(100, Number(score) || 0));
  fillEl.style.width = `${clampedScore}%`;
  fillEl.style.background = getScoreColour(clampedScore);
}

function clearCurrentTicket() {
  frustrationScoreEl.textContent = '-';
  currentTicketIdEl.textContent = '-';
  currentTicketTitleEl.textContent = '-';
  currentTicketReasonEl.textContent = '-';
  lastUpdatedRawValueEl.textContent = '-';
  setSignalBar(lastUpdatedSignalFillEl, 0);
  nowReadingPanelEl.classList.add('hidden');
}

function setCurrentTicket(ticket) {
  if (!ticket) {
    clearCurrentTicket();
    return;
  }

  frustrationScoreEl.textContent = Math.round(ticket.frustrationScore ?? 0);
  currentTicketIdEl.textContent = ticket.id ?? '-';
  currentTicketTitleEl.textContent = ticket.title ?? '-';
  currentTicketReasonEl.textContent = ticket.reason ?? '-';

  const lastUpdated = ticket.signals?.lastUpdated;
  lastUpdatedRawValueEl.textContent = lastUpdated?.rawValue ?? '-';
  setSignalBar(lastUpdatedSignalFillEl, lastUpdated?.score ?? 0);

  nowReadingPanelEl.classList.remove('hidden');
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
    clearCurrentTicket();

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
    clearCurrentTicket();
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadState();
  }
});

clearCurrentTicket();
loadState();

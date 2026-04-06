const statusEl = document.getElementById('status');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');

const nowReadingPanelEl = document.getElementById('nowReadingPanel');
const frustrationScoreEl = document.getElementById('frustrationScore');
const currentTicketTitleEl = document.getElementById('currentTicketTitle');
const currentTicketReasonEl = document.getElementById('currentTicketReason');

const lastUpdatedLabelEl = document.getElementById('lastUpdatedLabel');
const lastUpdatedRawValueEl = document.getElementById('lastUpdatedRawValue');
const lastUpdatedBarEl = document.getElementById('lastUpdatedBar');

const timeInColumnLabelEl = document.getElementById('timeInColumnLabel');
const timeInColumnRawValueEl = document.getElementById('timeInColumnRawValue');
const timeInColumnBarEl = document.getElementById('timeInColumnBar');

function setStatus(message) {
  statusEl.textContent = message;
}

function getScoreColor(score) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));

  if (clamped <= 50) {
    const t = clamped / 50;
    const r = Math.round(76 + (255 - 76) * t);
    const g = Math.round(175 + (193 - 175) * t);
    const b = Math.round(80 + (7 - 80) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  const t = (clamped - 50) / 50;
  const r = 255;
  const g = Math.round(193 + (59 - 193) * t);
  const b = Math.round(7 + (48 - 7) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function resetSignalDisplay(labelEl, rawValueEl, barEl, defaultLabel) {
  labelEl.textContent = defaultLabel;
  rawValueEl.textContent = '-';
  barEl.style.width = '0%';
  barEl.style.background = getScoreColor(0);
  barEl.classList.remove('unavailable');
}

function applySignalDisplay({ labelEl, rawValueEl, barEl, signal, defaultLabel }) {
  if (!signal) {
    resetSignalDisplay(labelEl, rawValueEl, barEl, defaultLabel);
    return;
  }

  labelEl.textContent = signal.label || defaultLabel;
  rawValueEl.textContent = signal.rawValue || '-';

  if (signal.isAvailable === false || !Number.isFinite(Number(signal.score))) {
    barEl.style.width = '100%';
    barEl.style.background = '#cfcfcf';
    barEl.classList.add('unavailable');
    return;
  }

  const score = Math.max(0, Math.min(100, Number(signal.score) || 0));
  barEl.style.width = `${score}%`;
  barEl.style.background = getScoreColor(score);
  barEl.classList.remove('unavailable');
}

function setCurrentTicket(ticket) {
  if (!ticket) {
    frustrationScoreEl.textContent = '-';
    currentTicketTitleEl.textContent = '-';
    currentTicketReasonEl.textContent = '-';
    resetSignalDisplay(lastUpdatedLabelEl, lastUpdatedRawValueEl, lastUpdatedBarEl, 'Last updated');
    resetSignalDisplay(timeInColumnLabelEl, timeInColumnRawValueEl, timeInColumnBarEl, 'Time in column');
    nowReadingPanelEl.classList.add('hidden');
    return;
  }

  frustrationScoreEl.textContent = Number.isFinite(ticket.frustrationScore)
    ? String(Math.round(ticket.frustrationScore))
    : '-';

  currentTicketTitleEl.textContent = ticket.title ?? '-';
  currentTicketReasonEl.textContent = ticket.reason ?? '-';

  applySignalDisplay({
    labelEl: lastUpdatedLabelEl,
    rawValueEl: lastUpdatedRawValueEl,
    barEl: lastUpdatedBarEl,
    signal: ticket.signals?.lastUpdated,
    defaultLabel: 'Last updated'
  });

  applySignalDisplay({
    labelEl: timeInColumnLabelEl,
    rawValueEl: timeInColumnRawValueEl,
    barEl: timeInColumnBarEl,
    signal: ticket.signals?.timeInColumn,
    defaultLabel: 'Time in column'
  });

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

resetSignalDisplay(lastUpdatedLabelEl, lastUpdatedRawValueEl, lastUpdatedBarEl, 'Last updated');
resetSignalDisplay(timeInColumnLabelEl, timeInColumnRawValueEl, timeInColumnBarEl, 'Time in column');
loadState();
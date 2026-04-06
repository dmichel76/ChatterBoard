const statusEl = document.getElementById('status');
const startButton = document.getElementById('startButton');
const previousButton = document.getElementById('previousButton');
const nextButton = document.getElementById('nextButton');
const clearButton = document.getElementById('clearButton');

const nowReadingPanelEl = document.getElementById('nowReadingPanel');
const frustrationIconEl = document.getElementById('frustrationIcon');
const frustrationNumberEl = document.getElementById('frustrationNumber');
const currentTicketTitleEl = document.getElementById('currentTicketTitle');

const lastUpdatedLabelEl = document.getElementById('lastUpdatedLabel');
const lastUpdatedRawValueEl = document.getElementById('lastUpdatedRawValue');
const lastUpdatedBarEl = document.getElementById('lastUpdatedBar');

const timeInColumnLabelEl = document.getElementById('timeInColumnLabel');
const timeInColumnRawValueEl = document.getElementById('timeInColumnRawValue');
const timeInColumnBarEl = document.getElementById('timeInColumnBar');

const timeInProgressLabelEl = document.getElementById('timeInProgressLabel');
const timeInProgressRawValueEl = document.getElementById('timeInProgressRawValue');
const timeInProgressBarEl = document.getElementById('timeInProgressBar');

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

function getFrustrationFaceIcon(score) {
  if (!Number.isFinite(score)) {
    return '-';
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  
  // Mild skew: Calm 0-30, Concerned 31-50, Worried 51-70, Frustrated 71-85, Angry 86-100
  let level;
  if (clamped <= 30) {
    level = 0; // Calm
  } else if (clamped <= 50) {
    level = 1; // Slightly Concerned
  } else if (clamped <= 70) {
    level = 2; // Worried
  } else if (clamped <= 85) {
    level = 3; // Frustrated
  } else {
    level = 4; // Angry
  }

  const faces = [
    {
      color: '#4CAF50',
      label: 'Calm',
      svg: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="15" fill="#4CAF50" stroke="#2E7D32" stroke-width="2"/>
        <circle cx="11" cy="12" r="2" fill="#1B5E20"/>
        <circle cx="21" cy="12" r="2" fill="#1B5E20"/>
        <path d="M 10 19 Q 16 24 22 19" stroke="#1B5E20" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>`
    },
    {
      color: '#8BC34A',
      label: 'Slightly Concerned',
      svg: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="15" fill="#8BC34A" stroke="#689F38" stroke-width="2"/>
        <circle cx="11" cy="12" r="2" fill="#33691E"/>
        <circle cx="21" cy="12" r="2" fill="#33691E"/>
        <path d="M 10 20 Q 16 22 22 20" stroke="#33691E" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>`
    },
    {
      color: '#FFC107',
      label: 'Worried',
      svg: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="15" fill="#FFC107" stroke="#FFA000" stroke-width="2"/>
        <circle cx="11" cy="12" r="2" fill="#F57F17"/>
        <circle cx="21" cy="12" r="2" fill="#F57F17"/>
        <line x1="10" y1="20" x2="22" y2="20" stroke="#F57F17" stroke-width="2" stroke-linecap="round"/>
      </svg>`
    },
    {
      color: '#FF9800',
      label: 'Frustrated',
      svg: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="15" fill="#FF9800" stroke="#F57C00" stroke-width="2"/>
        <line x1="8" y1="10" x2="12" y2="13" stroke="#E65100" stroke-width="2" stroke-linecap="round"/>
        <line x1="20" y1="13" x2="24" y2="10" stroke="#E65100" stroke-width="2" stroke-linecap="round"/>
        <circle cx="11" cy="14" r="2" fill="#E65100"/>
        <circle cx="21" cy="14" r="2" fill="#E65100"/>
        <path d="M 10 23 Q 16 19 22 23" stroke="#E65100" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>`
    },
    {
      color: '#F44336',
      label: 'Angry',
      svg: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="15" fill="#F44336" stroke="#D32F2F" stroke-width="2"/>
        <line x1="7" y1="10" x2="13" y2="13" stroke="#B71C1C" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="19" y1="13" x2="25" y2="10" stroke="#B71C1C" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="11" cy="14" r="2.5" fill="#B71C1C"/>
        <circle cx="21" cy="14" r="2.5" fill="#B71C1C"/>
        <path d="M 10 24 Q 16 20 22 24" stroke="#B71C1C" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      </svg>`
    }
  ];

  return faces[level].svg;
}

function setCurrentTicket(ticket) {
  if (!ticket) {
    frustrationIconEl.innerHTML = '-';
    frustrationNumberEl.textContent = '-';
    currentTicketTitleEl.textContent = '-';
    resetSignalDisplay(lastUpdatedLabelEl, lastUpdatedRawValueEl, lastUpdatedBarEl, 'Last updated');
    resetSignalDisplay(timeInColumnLabelEl, timeInColumnRawValueEl, timeInColumnBarEl, 'Time in column');
    resetSignalDisplay(timeInProgressLabelEl, timeInProgressRawValueEl, timeInProgressBarEl, 'Time in progress');
    nowReadingPanelEl.classList.add('hidden');
    return;
  }

  if (Number.isFinite(ticket.frustrationScore)) {
    const roundedScore = Math.round(ticket.frustrationScore);
    frustrationIconEl.innerHTML = getFrustrationFaceIcon(ticket.frustrationScore);
    frustrationNumberEl.textContent = String(roundedScore);
  } else {
    frustrationIconEl.innerHTML = '-';
    frustrationNumberEl.textContent = '-';
  }

  currentTicketTitleEl.textContent = ticket.title ?? '-';

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

  applySignalDisplay({
    labelEl: timeInProgressLabelEl,
    rawValueEl: timeInProgressRawValueEl,
    barEl: timeInProgressBarEl,
    signal: ticket.signals?.timeInProgress,
    defaultLabel: 'Time in progress'
  });

  nowReadingPanelEl.classList.remove('hidden');
}

function applyState(state) {
  if (!state) return;

  setStatus(state.statusMessage || 'Idle.');
  setCurrentTicket(state.currentTicket || null);

  const hasQueue = state.isQueueLoaded && state.queueLength > 0;
  const atFirst = state.currentQueueIndex === 0;
  const atLast = state.currentQueueIndex === state.queueLength - 1;

  startButton.disabled = hasQueue;
  clearButton.disabled = !hasQueue;
  previousButton.disabled = !hasQueue || atFirst;
  nextButton.disabled = !hasQueue || atLast;
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

startButton.addEventListener('click', async () => {
  try {
    setStatus('Loading...');
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
      type: 'LOAD_CHATTERBOARD',
      tabId: tab.id,
      url: tab.url
    });

    if (!response?.ok) {
      setStatus(response?.error || 'Unknown error.');
      return;
    }

    if (response.count === 0) {
      setStatus('No tickets met the criteria.');
      return;
    }

    setStatus(`Loaded ${response.count} ticket(s).`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadState();
  }
});

nextButton.addEventListener('click', async () => {
  try {
    setStatus('Moving to next ticket...');
    
    const response = await chrome.runtime.sendMessage({
      type: 'NEXT_TICKET'
    });

    if (!response?.ok) {
      setStatus(response?.error || 'Could not move to next ticket.');
      return;
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadState();
  }
});

previousButton.addEventListener('click', async () => {
  try {
    setStatus('Moving to previous ticket...');
    
    const response = await chrome.runtime.sendMessage({
      type: 'PREVIOUS_TICKET'
    });

    if (!response?.ok) {
      setStatus(response?.error || 'Could not move to previous ticket.');
      return;
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadState();
  }
});

clearButton.addEventListener('click', async () => {
  try {
    setStatus('Clearing...');
    const response = await chrome.runtime.sendMessage({
      type: 'STOP_CHATTERBOARD'
    });

    if (!response?.ok) {
      setStatus(response?.error || 'Could not clear queue.');
      return;
    }

    setCurrentTicket(null);
    setStatus('Cleared.');
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadState();
  }
});

resetSignalDisplay(lastUpdatedLabelEl, lastUpdatedRawValueEl, lastUpdatedBarEl, 'Last updated');
resetSignalDisplay(timeInColumnLabelEl, timeInColumnRawValueEl, timeInColumnBarEl, 'Time in column');
resetSignalDisplay(timeInProgressLabelEl, timeInProgressRawValueEl, timeInProgressBarEl, 'Time in progress');
loadState();
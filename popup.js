const DEFAULT_SETTINGS = {
  scoringMode: 'relative',
  absoluteScaleMaxDays: 30
};

const statusEl = document.getElementById('status');
const playButton = document.getElementById('playButton');
const pauseButton = document.getElementById('pauseButton');
const stopButton = document.getElementById('stopButton');

const scaleInfoEl = document.getElementById('scaleInfo');
const scaleInfoValueEl = document.getElementById('scaleInfoValue');

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

function formatScaleInfo(settings) {
  const scoringMode = settings?.scoringMode === 'absolute' ? 'absolute' : 'relative';
  const absoluteScaleMaxDays = Number.isFinite(Number(settings?.absoluteScaleMaxDays))
    ? Math.max(1, Math.round(Number(settings.absoluteScaleMaxDays)))
    : DEFAULT_SETTINGS.absoluteScaleMaxDays;

  if (scoringMode === 'absolute') {
    return `Absolute, 100 = ${absoluteScaleMaxDays} day${absoluteScaleMaxDays === 1 ? '' : 's'}`;
  }

  return 'Relative, 100 = worst active visible duration on this board';
}

function setScaleInfo(settings) {
  scaleInfoValueEl.textContent = formatScaleInfo(settings || DEFAULT_SETTINGS);
  scaleInfoEl.classList.remove('hidden');
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(['scoringMode', 'absoluteScaleMaxDays']);
  setScaleInfo({
    scoringMode: stored.scoringMode,
    absoluteScaleMaxDays: stored.absoluteScaleMaxDays
  });
}

function applyState(state) {
  if (!state) return;

  setStatus(state.statusMessage || 'Idle.');
  setCurrentTicket(state.currentTicket || null);

  playButton.disabled = !!state.isRunning || !!state.isPaused;
  stopButton.disabled = !state.isRunning && !state.isPaused;

  if (state.isPaused) {
    pauseButton.disabled = false;
    pauseButton.textContent = 'Resume';
  } else if (state.isRunning) {
    pauseButton.disabled = false;
    pauseButton.textContent = state.pauseRequested ? 'Pause...' : 'Pause';
  } else {
    pauseButton.disabled = true;
    pauseButton.textContent = 'Pause';
  }
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
    await loadSettings();

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

    if (response.paused) {
      setStatus('Paused. Ready to resume.');
      return;
    }

    setStatus(`Done. Spoke ${response.count} ticket(s).`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadSettings();
    await loadState();
  }
});

pauseButton.addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_CHATTERBOARD_STATE'
    });

    if (!response?.ok) {
      setStatus('Could not read current state.');
      return;
    }

    const state = response.state;

    if (state.isPaused) {
      setStatus('Resuming...');
      const resumeResponse = await chrome.runtime.sendMessage({
        type: 'RESUME_CHATTERBOARD'
      });

      if (!resumeResponse?.ok) {
        setStatus(resumeResponse?.error || 'Could not resume ChatterBoard.');
        return;
      }

      if (resumeResponse.stopped) {
        setStatus('Stopped.');
        return;
      }

      if (resumeResponse.paused) {
        setStatus('Paused. Ready to resume.');
        return;
      }

      setStatus(`Done. Spoke ${resumeResponse.count} ticket(s).`);
      return;
    }

    if (state.isRunning) {
      setStatus('Pausing after current ticket...');
      const pauseResponse = await chrome.runtime.sendMessage({
        type: 'PAUSE_CHATTERBOARD'
      });

      if (!pauseResponse?.ok) {
        setStatus(pauseResponse?.error || 'Could not pause ChatterBoard.');
      }
    }
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
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    await loadSettings();
    await loadState();
  }
});

resetSignalDisplay(lastUpdatedLabelEl, lastUpdatedRawValueEl, lastUpdatedBarEl, 'Last updated');
resetSignalDisplay(timeInColumnLabelEl, timeInColumnRawValueEl, timeInColumnBarEl, 'Time in column');
loadSettings();
loadState();
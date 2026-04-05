const MAX_TICKETS_TO_SPEAK = 5;
const WORK_ITEM_BATCH_SIZE = 200;

const runState = {
  isRunning: false,
  stopRequested: false,
  currentTabId: null,
  currentHighlightedTicketId: null,
  currentTicket: null,
  statusMessage: 'Idle.'
};

function setRunState(patch) {
  Object.assign(runState, patch);
  broadcastState();
}

function broadcastState() {
  chrome.runtime.sendMessage(
    {
      type: 'CHATTERBOARD_STATE',
      state: {
        isRunning: runState.isRunning,
        stopRequested: runState.stopRequested,
        currentTabId: runState.currentTabId,
        currentHighlightedTicketId: runState.currentHighlightedTicketId,
        currentTicket: runState.currentTicket,
        statusMessage: runState.statusMessage
      }
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function speak(text) {
  return new Promise((resolve, reject) => {
    chrome.tts.stop();

    chrome.tts.speak(text, {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      onEvent: (event) => {
        if (event.type === 'end') {
          resolve();
          return;
        }

        if (event.type === 'interrupted' || event.type === 'cancelled') {
          if (runState.stopRequested) {
            resolve();
          } else {
            reject(new Error(`TTS failed: ${event.type}`));
          }
          return;
        }

        if (event.type === 'error') {
          reject(new Error(`TTS failed: ${event.type}`));
        }
      }
    });
  });
}

function parseAdoUrl(url) {
  const devAzureMatch = url.match(/^https:\/\/dev\.azure\.com\/([^/]+)\/([^/?#]+)/i);
  if (devAzureMatch) {
    return {
      org: decodeURIComponent(devAzureMatch[1]),
      project: decodeURIComponent(devAzureMatch[2])
    };
  }

  const visualStudioMatch = url.match(/^https:\/\/([^/.]+)\.visualstudio\.com\/([^/?#]+)/i);
  if (visualStudioMatch) {
    return {
      org: decodeURIComponent(visualStudioMatch[1]),
      project: decodeURIComponent(visualStudioMatch[2])
    };
  }

  return null;
}

async function fetchWorkItemsBatch({ org, project, adoPat, ids }) {
  const response = await fetch(
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(',')}&api-version=7.0`,
    {
      headers: {
        Authorization: 'Basic ' + btoa(':' + adoPat)
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ADO workitems failed: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.json();
}

function chunkArray(items, size) {
  const chunks = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

async function fetchAllWorkItems({ org, project, adoPat, ids }) {
  const batches = chunkArray(ids, WORK_ITEM_BATCH_SIZE);
  const allItems = [];

  for (const batchIds of batches) {
    ensureNotStopped();

    const batchData = await fetchWorkItemsBatch({
      org,
      project,
      adoPat,
      ids: batchIds
    });

    allItems.push(...(batchData.value || []));
  }

  return allItems;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function clearCurrentHighlightIfAny() {
  if (!runState.currentTabId || !runState.currentHighlightedTicketId) {
    return;
  }

  try {
    await sendTabMessage(runState.currentTabId, {
      type: 'CLEAR_HIGHLIGHT_TICKET',
      workItemId: runState.currentHighlightedTicketId
    });
  } catch (error) {
    console.warn('Failed to clear current highlight', error);
  }

  runState.currentHighlightedTicketId = null;
}

function requestStop() {
  runState.stopRequested = true;
  chrome.tts.stop();
  setRunState({
    stopRequested: true,
    statusMessage: 'Stopping...'
  });
}

function ensureNotStopped() {
  if (runState.stopRequested) {
    throw new Error('Run stopped by user.');
  }
}

function getElapsedMsSinceChanged(item) {
  const changedDate = item.fields['System.ChangedDate'];

  if (!changedDate) {
    return 0;
  }

  const changedTime = new Date(changedDate).getTime();
  if (Number.isNaN(changedTime)) {
    return 0;
  }

  return Math.max(0, Date.now() - changedTime);
}

function formatDurationShort(durationMs) {
  const hourMs = 1000 * 60 * 60;
  const dayMs = hourMs * 24;

  if (durationMs < hourMs) {
    return 'just now';
  }

  const totalHours = Math.floor(durationMs / hourMs);

  if (durationMs < dayMs) {
    return `${totalHours}h`;
  }

  const days = Math.floor(durationMs / dayMs);
  const hours = Math.floor((durationMs % dayMs) / hourMs);

  if (hours === 0) {
    return `${days}d`;
  }

  return `${days}d ${hours}h`;
}

function formatDurationForSpeech(durationMs) {
  const hourMs = 1000 * 60 * 60;
  const dayMs = hourMs * 24;

  if (durationMs < hourMs) {
    return 'just now';
  }

  if (durationMs < dayMs) {
    const hours = Math.max(1, Math.round(durationMs / hourMs));
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.max(1, Math.round(durationMs / dayMs));
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function normaliseValueToScore(value, minValue, maxValue) {
  if (maxValue <= minValue) {
    return 50;
  }

  const raw = ((value - minValue) / (maxValue - minValue)) * 100;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped);
}

async function getActiveVisibleTicketIds(tabId) {
  const response = await sendTabMessage(tabId, {
    type: 'GET_ACTIVE_VISIBLE_TICKET_IDS'
  });

  return (response?.ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id));
}

function buildLastUpdatedSignalEntries(items) {
  const elapsedValues = items.map((item) => getElapsedMsSinceChanged(item));
  const minElapsedMs = Math.min(...elapsedValues);
  const maxElapsedMs = Math.max(...elapsedValues);

  return items.map((item) => {
    const elapsedMs = getElapsedMsSinceChanged(item);
    const normalisedScore = normaliseValueToScore(elapsedMs, minElapsedMs, maxElapsedMs);

    return {
      item,
      signals: {
        lastUpdated: {
          label: 'Last updated',
          rawValue: formatDurationShort(elapsedMs),
          speechValue: formatDurationForSpeech(elapsedMs),
          normalisedScore
        }
      },
      frustrationScore: normalisedScore
    };
  });
}

function sortEntriesForPlayback(entries) {
  return [...entries].sort((a, b) => {
    if (b.frustrationScore !== a.frustrationScore) {
      return b.frustrationScore - a.frustrationScore;
    }

    const aElapsed = getElapsedMsSinceChanged(a.item);
    const bElapsed = getElapsedMsSinceChanged(b.item);

    if (bElapsed !== aElapsed) {
      return bElapsed - aElapsed;
    }

    return Number(a.item.id) - Number(b.item.id);
  });
}

async function runChatterBoard({ tabId, url }) {
  if (runState.isRunning) {
    throw new Error('ChatterBoard is already running.');
  }

  setRunState({
    isRunning: true,
    stopRequested: false,
    currentTabId: tabId,
    currentHighlightedTicketId: null,
    currentTicket: null,
    statusMessage: 'Starting...'
  });

  try {
    if (!tabId || !url) {
      throw new Error('Missing tabId or url.');
    }

    const stored = await chrome.storage.sync.get(['adoPat']);
    const adoPat = (stored.adoPat || '').trim();

    if (!adoPat) {
      throw new Error('No Azure DevOps PAT found in Options.');
    }

    const parsed = parseAdoUrl(url);
    if (!parsed) {
      throw new Error('Could not parse organisation and project from the URL.');
    }

    setRunState({
      statusMessage: 'Reading visible active tickets from the board...'
    });

    const ids = await getActiveVisibleTicketIds(tabId);

    ensureNotStopped();

    if (!ids.length) {
      setRunState({
        statusMessage: 'No active visible work items found on the current board.'
      });
      await speak('No active work items found.');
      return { ok: true, count: 0 };
    }

    setRunState({
      statusMessage: `Loading ${ids.length} visible active work item(s)...`
    });

    const items = await fetchAllWorkItems({
      org: parsed.org,
      project: parsed.project,
      adoPat,
      ids
    });

    ensureNotStopped();

    const entries = buildLastUpdatedSignalEntries(items);
    const sortedEntries = sortEntriesForPlayback(entries);
    const selected = sortedEntries.slice(0, MAX_TICKETS_TO_SPEAK);

    for (const entry of selected) {
      ensureNotStopped();

      const id = entry.item.id;
      const title = entry.item.fields['System.Title'] || 'Untitled work item';
      const lastUpdated = entry.signals.lastUpdated;

      setRunState({
        currentHighlightedTicketId: id,
        currentTicket: {
          id,
          title,
          reason: `Last updated ${lastUpdated.rawValue} ago`,
          frustrationScore: entry.frustrationScore,
          signals: {
            lastUpdated: {
              label: lastUpdated.label,
              rawValue: lastUpdated.rawValue,
              score: lastUpdated.normalisedScore
            }
          }
        },
        statusMessage: `Reading ticket ${id}...`
      });

      try {
        await sendTabMessage(tabId, {
          type: 'SCROLL_TICKET_INTO_VIEW',
          workItemId: id
        });
      } catch (error) {
        console.warn('Scroll failed', id, error);
      }

      try {
        await sendTabMessage(tabId, {
          type: 'HIGHLIGHT_TICKET',
          workItemId: id
        });
      } catch (error) {
        console.warn('Highlight failed', id, error);
      }

      await speak(`Last updated ${lastUpdated.speechValue}. ${title}`);
      ensureNotStopped();

      try {
        await sendTabMessage(tabId, {
          type: 'CLEAR_HIGHLIGHT_TICKET',
          workItemId: id
        });
      } catch (error) {
        console.warn('Clear highlight failed', id, error);
      }

      setRunState({
        currentHighlightedTicketId: null,
        currentTicket: null,
        statusMessage: 'Moving to next ticket...'
      });
    }

    setRunState({
      statusMessage: `Done. Spoke ${selected.length} ticket(s).`
    });

    return { ok: true, count: selected.length };
  } catch (error) {
    if (error.message === 'Run stopped by user.') {
      await clearCurrentHighlightIfAny();
      setRunState({
        currentHighlightedTicketId: null,
        currentTicket: null,
        statusMessage: 'Stopped.'
      });
      return { ok: true, count: 0, stopped: true };
    }

    await clearCurrentHighlightIfAny();
    setRunState({
      currentHighlightedTicketId: null,
      currentTicket: null,
      statusMessage: `Error: ${error.message}`
    });
    throw error;
  } finally {
    setRunState({
      isRunning: false,
      stopRequested: false,
      currentTabId: null,
      currentHighlightedTicketId: null,
      currentTicket: null
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'RUN_CHATTERBOARD') {
    runChatterBoard({
      tabId: message.tabId,
      url: message.url
    })
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === 'STOP_CHATTERBOARD') {
    requestStop();
    clearCurrentHighlightIfAny()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === 'GET_CHATTERBOARD_STATE') {
    sendResponse({
      ok: true,
      state: {
        isRunning: runState.isRunning,
        stopRequested: runState.stopRequested,
        currentTabId: runState.currentTabId,
        currentHighlightedTicketId: runState.currentHighlightedTicketId,
        currentTicket: runState.currentTicket,
        statusMessage: runState.statusMessage
      }
    });
    return true;
  }

  return false;
});
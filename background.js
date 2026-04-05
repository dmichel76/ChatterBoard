const MAX_TICKETS_TO_SPEAK = 5;

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
  chrome.runtime.sendMessage({
    type: 'CHATTERBOARD_STATE',
    state: {
      isRunning: runState.isRunning,
      stopRequested: runState.stopRequested,
      currentTabId: runState.currentTabId,
      currentHighlightedTicketId: runState.currentHighlightedTicketId,
      currentTicket: runState.currentTicket,
      statusMessage: runState.statusMessage
    }
  }, () => {
    void chrome.runtime.lastError;
  });
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
        } else if (
          event.type === 'error' ||
          event.type === 'interrupted' ||
          event.type === 'cancelled'
        ) {
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

async function runWiqlQuery({ org, project, adoPat }) {
  const wiql = {
    query: `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.TeamProject] = '${project}'
      ORDER BY [System.ChangedDate] ASC
    `
  };

  const response = await fetch(
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(':' + adoPat)
      },
      body: JSON.stringify(wiql)
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ADO WIQL failed: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.json();
}

async function fetchWorkItems({ org, project, adoPat, ids }) {
  const response = await fetch(
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(',')}&api-version=7.0`,
    {
      headers: {
        'Authorization': 'Basic ' + btoa(':' + adoPat)
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ADO workitems failed: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.json();
}

function scoreWorkItem(item) {
  const changedDate = item.fields['System.ChangedDate'];

  if (!changedDate) {
    return { score: 0, ageDays: 0 };
  }

  const ageMs = Date.now() - new Date(changedDate).getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  return {
    score: ageDays > 2 ? 1 : 0,
    ageDays
  };
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
      statusMessage: `Querying Azure DevOps for ${parsed.project}...`
    });

    const data = await runWiqlQuery({
      org: parsed.org,
      project: parsed.project,
      adoPat
    });

    ensureNotStopped();

    const visibleResponse = await sendTabMessage(tabId, {
      type: 'GET_VISIBLE_TICKET_IDS'
    });

    const visibleIds = new Set((visibleResponse?.ids || []).map(String));

    const ids = (data.workItems || [])
      .map((item) => item.id)
      .filter((id) => visibleIds.has(String(id)))
      .slice(0, 40);

    if (!ids.length) {
      setRunState({
        statusMessage: 'No visible work items found on the current board.'
      });
      await speak('No work items found.');
      return { ok: true, count: 0 };
    }

    const workItemsData = await fetchWorkItems({
      org: parsed.org,
      project: parsed.project,
      adoPat,
      ids
    });

    ensureNotStopped();

    const items = workItemsData.value || [];

    const scored = items.map((item) => {
      const result = scoreWorkItem(item);
      return {
        item,
        score: result.score,
        ageDays: result.ageDays
      };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.ageDays - a.ageDays;
    });

    const selected = [];

    for (const entry of scored) {
      ensureNotStopped();

      const id = entry.item.id;

      try {
        const placement = await sendTabMessage(tabId, {
          type: 'IS_TICKET_IN_ACTIVE_COLUMN',
          workItemId: id
        });

        if (placement?.isActiveColumn) {
          selected.push(entry);
        }
      } catch (error) {
        console.warn('Could not inspect ticket column placement', id, error);
      }

      if (selected.length >= MAX_TICKETS_TO_SPEAK) {
        break;
      }
    }

    if (!selected.length) {
      setRunState({
        statusMessage: 'No active tickets found outside the first and last columns.'
      });
      await speak('No active tickets found outside the first and last columns.');
      return { ok: true, count: 0 };
    }

    for (const entry of selected) {
      ensureNotStopped();

      const id = entry.item.id;
      const title = entry.item.fields['System.Title'] || 'Untitled work item';
      const reason = `No update for ${entry.ageDays} days`;

      setRunState({
        currentHighlightedTicketId: id,
        currentTicket: {
          id,
          title,
          reason
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

      await speak(`${reason}. ${title}`);

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
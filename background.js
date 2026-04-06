const DEFAULT_VOICE_SIGNAL_THRESHOLD = 75;
const DEFAULT_MAX_TICKETS_TO_SPEAK = 5;
const DEFAULT_SCORING_MODE = 'relative';
const DEFAULT_ABSOLUTE_SCALE_MAX_DAYS = 30;
const WORK_ITEM_BATCH_SIZE = 200;
const WORK_ITEM_REVISIONS_TOP = 200;

const runState = {
  isRunning: false,
  isPaused: false,
  pauseRequested: false,
  stopRequested: false,
  currentTabId: null,
  currentHighlightedTicketId: null,
  currentTicket: null,
  statusMessage: 'Idle.',
  queue: [],
  currentQueueIndex: 0
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
        isPaused: runState.isPaused,
        pauseRequested: runState.pauseRequested,
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

async function getRuntimeSettings() {
  const stored = await chrome.storage.sync.get([
    'adoPat',
    'voiceSignalThreshold',
    'scoringMode',
    'absoluteScaleMaxDays',
    'maxTicketsToSpeak'
  ]);

  const voiceSignalThreshold = clampNumber(
    stored.voiceSignalThreshold,
    0,
    100,
    DEFAULT_VOICE_SIGNAL_THRESHOLD
  );

  const maxTicketsToSpeak = clampNumber(
    stored.maxTicketsToSpeak,
    1,
    50,
    DEFAULT_MAX_TICKETS_TO_SPEAK
  );

  const scoringMode =
    stored.scoringMode === 'absolute' ? 'absolute' : DEFAULT_SCORING_MODE;

  const absoluteScaleMaxDays = clampNumber(
    stored.absoluteScaleMaxDays,
    1,
    3650,
    DEFAULT_ABSOLUTE_SCALE_MAX_DAYS
  );

  const adoPat = (stored.adoPat || '').trim();

  return {
    adoPat,
    voiceSignalThreshold,
    scoringMode,
    absoluteScaleMaxDays,
    maxTicketsToSpeak
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
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

async function fetchWorkItemRevisions({ org, project, adoPat, id }) {
  const response = await fetch(
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent(id)}/revisions?$top=${WORK_ITEM_REVISIONS_TOP}&api-version=7.0`,
    {
      headers: {
        Authorization: 'Basic ' + btoa(':' + adoPat)
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `ADO revisions failed for ${id}: ${response.status} ${response.statusText} - ${body}`
    );
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
  runState.pauseRequested = false;
  runState.isPaused = false;
  runState.queue = [];
  runState.currentQueueIndex = 0;
  chrome.tts.stop();
  setRunState({
    stopRequested: true,
    pauseRequested: false,
    isPaused: false,
    statusMessage: 'Stopping...'
  });
}

function requestPause() {
  if (!runState.isRunning || runState.isPaused) {
    return;
  }

  setRunState({
    pauseRequested: true,
    statusMessage: 'Pausing after current ticket...'
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
    return null;
  }

  const changedTime = new Date(changedDate).getTime();
  if (Number.isNaN(changedTime)) {
    return null;
  }

  return Math.max(0, Date.now() - changedTime);
}

function formatDurationShort(durationMs) {
  const hourMs = 1000 * 60 * 60;
  const dayMs = hourMs * 24;

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return 'Unknown';
  }

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

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return 'an unknown amount of time';
  }

  if (durationMs < hourMs) {
    return 'just now';
  }

  if (durationMs < dayMs) {
    const hours = Math.max(1, Math.round(durationMs / hourMs));
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.max(1, Math.round(durationMs / dayMs));
  return `${days} day${days === 1 ? '' : 's'}`;
}

function normaliseDurationToRelativeScore(durationMs, globalMaxDurationMs) {
  if (!Number.isFinite(durationMs)) {
    return null;
  }

  if (!Number.isFinite(globalMaxDurationMs) || globalMaxDurationMs <= 0) {
    return 50;
  }

  const raw = (durationMs / globalMaxDurationMs) * 100;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped);
}

function normaliseDurationToAbsoluteScore(durationMs, absoluteScaleMaxMs) {
  if (!Number.isFinite(durationMs)) {
    return null;
  }

  if (!Number.isFinite(absoluteScaleMaxMs) || absoluteScaleMaxMs <= 0) {
    return 50;
  }

  const raw = (durationMs / absoluteScaleMaxMs) * 100;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped);
}

async function getActiveVisibleTicketIds(tabId) {
  const response = await sendTabMessage(tabId, {
    type: 'GET_ACTIVE_VISIBLE_TICKET_IDS'
  });

  return (response?.ids || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
}

function getChangedTimeFromFields(fields) {
  const changedDate = fields?.['System.ChangedDate'];
  if (!changedDate) {
    return null;
  }

  const changedTime = new Date(changedDate).getTime();
  return Number.isNaN(changedTime) ? null : changedTime;
}

function getBoardColumnFromFields(fields) {
  return fields?.['System.BoardColumn'] ?? null;
}

async function getElapsedMsSinceEnteredCurrentColumn({ org, project, adoPat, item }) {
  const currentColumn = getBoardColumnFromFields(item.fields);
  if (!currentColumn) {
    return null;
  }

  const revisionsData = await fetchWorkItemRevisions({
    org,
    project,
    adoPat,
    id: item.id
  });

  const revisions = revisionsData.value || [];
  if (!revisions.length) {
    return null;
  }

  for (let i = revisions.length - 1; i >= 0; i -= 1) {
    const revisionColumn = getBoardColumnFromFields(revisions[i].fields);

    if (revisionColumn !== currentColumn) {
      const entryRevision = revisions[i + 1];
      const entryTime = getChangedTimeFromFields(entryRevision?.fields);
      if (entryTime == null) {
        return null;
      }

      return Math.max(0, Date.now() - entryTime);
    }
  }

  const firstMatchingRevision = revisions.find(
    (revision) => getBoardColumnFromFields(revision.fields) === currentColumn
  );

  const firstMatchingTime = getChangedTimeFromFields(firstMatchingRevision?.fields);
  if (firstMatchingTime == null) {
    return null;
  }

  return Math.max(0, Date.now() - firstMatchingTime);
}

async function buildTimeInColumnElapsedMap({ org, project, adoPat, items }) {
  const elapsedMap = new Map();

  for (let index = 0; index < items.length; index += 1) {
    ensureNotStopped();

    const item = items[index];

    setRunState({
      statusMessage: `Reading column history ${index + 1}/${items.length}...`
    });

    try {
      const elapsedMs = await getElapsedMsSinceEnteredCurrentColumn({
        org,
        project,
        adoPat,
        item
      });

      elapsedMap.set(item.id, elapsedMs);
    } catch (error) {
      console.warn(`Could not get time-in-column for work item ${item.id}`, error);
      elapsedMap.set(item.id, null);
    }
  }

  return elapsedMap;
}

function getSignalDefinitions(item, timeInColumnElapsedMap) {
  const lastUpdatedDurationMs = getElapsedMsSinceChanged(item);
  const timeInColumnDurationMs = timeInColumnElapsedMap.get(item.id);

  return {
    lastUpdated: {
      key: 'lastUpdated',
      label: 'Last updated',
      durationMs: lastUpdatedDurationMs,
      rawValue: formatDurationShort(lastUpdatedDurationMs),
      speechValue: formatDurationForSpeech(lastUpdatedDurationMs),
      isAvailable: Number.isFinite(lastUpdatedDurationMs)
    },
    timeInColumn: {
      key: 'timeInColumn',
      label: 'Time in column',
      durationMs: timeInColumnDurationMs,
      rawValue: Number.isFinite(timeInColumnDurationMs)
        ? formatDurationShort(timeInColumnDurationMs)
        : 'Unknown',
      speechValue: Number.isFinite(timeInColumnDurationMs)
        ? formatDurationForSpeech(timeInColumnDurationMs)
        : null,
      isAvailable: Number.isFinite(timeInColumnDurationMs)
    }
  };
}

function getGlobalMaxDurationMs(signalDefinitionsByItem) {
  const allDurations = signalDefinitionsByItem.flatMap((signalSet) =>
    Object.values(signalSet)
      .filter((signal) => signal.isAvailable && Number.isFinite(signal.durationMs))
      .map((signal) => signal.durationMs)
  );

  if (!allDurations.length) {
    return null;
  }

  return Math.max(...allDurations);
}

function buildSignalEntries(items, timeInColumnElapsedMap, scoringMode, absoluteScaleMaxDays) {
  const signalDefinitionsByItem = items.map((item) =>
    getSignalDefinitions(item, timeInColumnElapsedMap)
  );

  const globalMaxDurationMs =
    scoringMode === 'relative'
      ? getGlobalMaxDurationMs(signalDefinitionsByItem)
      : null;

  const absoluteScaleMaxMs = absoluteScaleMaxDays * 24 * 60 * 60 * 1000;

  return items.map((item, index) => {
    const baseSignals = signalDefinitionsByItem[index];

    const signals = Object.fromEntries(
      Object.entries(baseSignals).map(([key, signal]) => {
        let score = null;

        if (signal.isAvailable) {
          score =
            scoringMode === 'absolute'
              ? normaliseDurationToAbsoluteScore(signal.durationMs, absoluteScaleMaxMs)
              : normaliseDurationToRelativeScore(signal.durationMs, globalMaxDurationMs);
        }

        return [
          key,
          {
            ...signal,
            score
          }
        ];
      })
    );

    const frustrationScore = Object.values(signals)
      .filter((signal) => signal.isAvailable && Number.isFinite(signal.score))
      .reduce((sum, signal) => sum + signal.score, 0);

    return {
      item,
      signals,
      frustrationScore
    };
  });
}

function getVoiceEligibleSignals(entry, voiceSignalThreshold) {
  return Object.values(entry.signals)
    .filter((signal) => signal.isAvailable && Number(signal.score) >= voiceSignalThreshold)
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const durationDiff = (b.durationMs || 0) - (a.durationMs || 0);
      if (durationDiff !== 0) {
        return durationDiff;
      }

      return 0;
    });
}

function getPrimarySignal(entry, voiceSignalThreshold) {
  const voiceEligible = getVoiceEligibleSignals(entry, voiceSignalThreshold);
  if (voiceEligible.length) {
    return voiceEligible[0];
  }

  return Object.values(entry.signals)
    .filter((signal) => signal.isAvailable && Number.isFinite(signal.score))
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const durationDiff = (b.durationMs || 0) - (a.durationMs || 0);
      if (durationDiff !== 0) {
        return durationDiff;
      }

      return 0;
    })[0] || entry.signals.lastUpdated;
}

function buildReasonFromSignal(signal) {
  if (signal.key === 'timeInColumn') {
    return `In this column for ${signal.rawValue}`;
  }

  return `Last updated ${signal.rawValue} ago`;
}

function buildVoiceSentenceFromSignal(signal) {
  if (signal.key === 'timeInColumn') {
    return `I have been stuck in this column for ${signal.speechValue}.`;
  }

  return `Nobody has touched me for ${signal.speechValue}.`;
}

function buildSpeechFromSignals(signals, title) {
  const complaintSentences = signals.map((signal) => buildVoiceSentenceFromSignal(signal));
  return [...complaintSentences, title].join(' ');
}

function sortEntriesForPlayback(entries, voiceSignalThreshold) {
  return [...entries].sort((a, b) => {
    if (b.frustrationScore !== a.frustrationScore) {
      return b.frustrationScore - a.frustrationScore;
    }

    const aPrimary = getPrimarySignal(a, voiceSignalThreshold);
    const bPrimary = getPrimarySignal(b, voiceSignalThreshold);

    if ((bPrimary.score || 0) !== (aPrimary.score || 0)) {
      return (bPrimary.score || 0) - (aPrimary.score || 0);
    }

    if ((bPrimary.durationMs || 0) !== (aPrimary.durationMs || 0)) {
      return (bPrimary.durationMs || 0) - (aPrimary.durationMs || 0);
    }

    return Number(a.item.id) - Number(b.item.id);
  });
}

async function playQueueFromCurrentState(voiceSignalThreshold) {
  while (runState.currentQueueIndex < runState.queue.length) {
    ensureNotStopped();

    if (runState.isPaused) {
      return { ok: true, paused: true, count: runState.currentQueueIndex };
    }

    if (runState.currentQueueIndex > 0 && runState.currentHighlightedTicketId) {
      await clearCurrentHighlightIfAny();
    }

    const entry = runState.queue[runState.currentQueueIndex];
    const id = entry.item.id;
    const title = entry.item.fields['System.Title'] || 'Untitled work item';
    const voiceSignals = getVoiceEligibleSignals(entry, voiceSignalThreshold);
    const primarySignal = voiceSignals[0] || getPrimarySignal(entry, voiceSignalThreshold);

    setRunState({
      currentHighlightedTicketId: id,
      currentTicket: {
        title,
        reason: buildReasonFromSignal(primarySignal),
        frustrationScore: entry.frustrationScore,
        signals: {
          lastUpdated: {
            label: entry.signals.lastUpdated.label,
            rawValue: entry.signals.lastUpdated.rawValue,
            score: entry.signals.lastUpdated.score,
            isAvailable: entry.signals.lastUpdated.isAvailable
          },
          timeInColumn: {
            label: entry.signals.timeInColumn.label,
            rawValue: entry.signals.timeInColumn.rawValue,
            score: entry.signals.timeInColumn.score,
            isAvailable: entry.signals.timeInColumn.isAvailable
          }
        }
      },
      statusMessage: `Reading ticket ${id}...`
    });

    try {
      await sendTabMessage(runState.currentTabId, {
        type: 'SCROLL_TICKET_INTO_VIEW',
        workItemId: id
      });
    } catch (error) {
      console.warn('Scroll failed', id, error);
    }

    try {
      await sendTabMessage(runState.currentTabId, {
        type: 'HIGHLIGHT_TICKET',
        workItemId: id
      });
    } catch (error) {
      console.warn('Highlight failed', id, error);
    }

    await speak(buildSpeechFromSignals(voiceSignals, title));
    ensureNotStopped();

    runState.currentQueueIndex += 1;

    if (runState.pauseRequested) {
      setRunState({
        isRunning: false,
        isPaused: true,
        pauseRequested: false,
        statusMessage: 'Paused. Ready to resume.'
      });
      return { ok: true, paused: true, count: runState.currentQueueIndex };
    }

    try {
      await sendTabMessage(runState.currentTabId, {
        type: 'CLEAR_HIGHLIGHT_TICKET',
        workItemId: id
      });
    } catch (error) {
      console.warn('Clear highlight failed', id, error);
    }

    setRunState({
      currentHighlightedTicketId: null,
      statusMessage: 'Moving to next ticket...'
    });
  }

  setRunState({
    isRunning: false,
    isPaused: false,
    pauseRequested: false,
    currentHighlightedTicketId: null,
    currentTicket: null,
    statusMessage: `Done. Spoke ${runState.currentQueueIndex} ticket(s).`
  });

  return { ok: true, count: runState.currentQueueIndex };
}

async function runChatterBoard({ tabId, url }) {
  if (runState.isRunning || runState.isPaused) {
    throw new Error('ChatterBoard is already running or paused.');
  }

  setRunState({
    isRunning: true,
    isPaused: false,
    pauseRequested: false,
    stopRequested: false,
    currentTabId: tabId,
    currentHighlightedTicketId: null,
    currentTicket: null,
    queue: [],
    currentQueueIndex: 0,
    statusMessage: 'Starting...'
  });

  try {
    if (!tabId || !url) {
      throw new Error('Missing tabId or url.');
    }

    const settings = await getRuntimeSettings();
    const {
      adoPat,
      voiceSignalThreshold,
      scoringMode,
      absoluteScaleMaxDays,
      maxTicketsToSpeak
    } = settings;

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
        isRunning: false,
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

    const timeInColumnElapsedMap = await buildTimeInColumnElapsedMap({
      org: parsed.org,
      project: parsed.project,
      adoPat,
      items
    });

    ensureNotStopped();

    const entries = buildSignalEntries(
      items,
      timeInColumnElapsedMap,
      scoringMode,
      absoluteScaleMaxDays
    );

    const speakingEntries = entries.filter(
      (entry) => getVoiceEligibleSignals(entry, voiceSignalThreshold).length > 0
    );

    const sortedEntries = sortEntriesForPlayback(speakingEntries, voiceSignalThreshold);
    const selected = sortedEntries.slice(0, maxTicketsToSpeak);

    if (!selected.length) {
      setRunState({
        isRunning: false,
        statusMessage: 'No tickets met the voice threshold.'
      });
      return { ok: true, count: 0 };
    }

    setRunState({
      queue: selected,
      currentQueueIndex: 0
    });

    return await playQueueFromCurrentState(voiceSignalThreshold);
  } catch (error) {
    if (error.message === 'Run stopped by user.') {
      await clearCurrentHighlightIfAny();
      setRunState({
        isRunning: false,
        isPaused: false,
        pauseRequested: false,
        stopRequested: false,
        currentHighlightedTicketId: null,
        currentTicket: null,
        queue: [],
        currentQueueIndex: 0,
        statusMessage: 'Stopped.'
      });
      return { ok: true, count: 0, stopped: true };
    }

    await clearCurrentHighlightIfAny();
    setRunState({
      isRunning: false,
      isPaused: false,
      pauseRequested: false,
      currentHighlightedTicketId: null,
      currentTicket: null,
      queue: [],
      currentQueueIndex: 0,
      statusMessage: `Error: ${error.message}`
    });
    throw error;
  } finally {
    runState.stopRequested = false;
  }
}

async function resumeChatterBoard() {
  if (!runState.isPaused) {
    throw new Error('ChatterBoard is not paused.');
  }

  const settings = await getRuntimeSettings();
  const { voiceSignalThreshold } = settings;

  setRunState({
    isRunning: true,
    isPaused: false,
    pauseRequested: false,
    stopRequested: false,
    statusMessage: 'Resuming...'
  });

  try {
    return await playQueueFromCurrentState(voiceSignalThreshold);
  } catch (error) {
    if (error.message === 'Run stopped by user.') {
      await clearCurrentHighlightIfAny();
      setRunState({
        isRunning: false,
        isPaused: false,
        pauseRequested: false,
        stopRequested: false,
        currentHighlightedTicketId: null,
        currentTicket: null,
        queue: [],
        currentQueueIndex: 0,
        statusMessage: 'Stopped.'
      });
      return { ok: true, count: 0, stopped: true };
    }

    await clearCurrentHighlightIfAny();
    setRunState({
      isRunning: false,
      isPaused: false,
      pauseRequested: false,
      currentHighlightedTicketId: null,
      currentTicket: null,
      queue: [],
      currentQueueIndex: 0,
      statusMessage: `Error: ${error.message}`
    });
    throw error;
  } finally {
    runState.stopRequested = false;
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

  if (message?.type === 'PAUSE_CHATTERBOARD') {
    try {
      requestPause();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return true;
  }

  if (message?.type === 'RESUME_CHATTERBOARD') {
    resumeChatterBoard()
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
        setRunState({
          currentHighlightedTicketId: null,
          currentTicket: null,
          queue: [],
          currentQueueIndex: 0
        });
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
        isPaused: runState.isPaused,
        pauseRequested: runState.pauseRequested,
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
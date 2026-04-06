const DEFAULT_MAX_TICKETS_TO_SPEAK = 5;
const DEFAULT_SCORING_MODE = 'relative';
const DEFAULT_ABSOLUTE_SCALE_MAX_DAYS = 30;
const WORK_ITEM_BATCH_SIZE = 200;
const WORK_ITEM_REVISIONS_TOP = 200;

const sentencesCache = {
  lastUpdated: null,
  timeInColumn: null
};

const runState = {
  isQueueLoaded: false,
  currentTabId: null,
  currentHighlightedTicketId: null,
  currentTicket: null,
  statusMessage: 'Idle.',
  queue: [],
  currentQueueIndex: -1
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
        isQueueLoaded: runState.isQueueLoaded,
        currentTabId: runState.currentTabId,
        currentHighlightedTicketId: runState.currentHighlightedTicketId,
        currentTicket: runState.currentTicket,
        statusMessage: runState.statusMessage,
        queueLength: runState.queue.length,
        currentQueueIndex: runState.currentQueueIndex
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
    'scoringMode',
    'absoluteScaleMaxDays',
    'maxTicketsToSpeak',
    'tagsToIgnore'
  ]);

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
  const tagsToIgnore = (stored.tagsToIgnore || '').trim();

  return {
    adoPat,
    scoringMode,
    absoluteScaleMaxDays,
    maxTicketsToSpeak,
    tagsToIgnore
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
          resolve();
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

function stopChatterBoard() {
  chrome.tts.stop();
  clearCurrentHighlightIfAny();
  setRunState({
    isQueueLoaded: false,
    currentTabId: null,
    currentHighlightedTicketId: null,
    currentTicket: null,
    queue: [],
    currentQueueIndex: -1,
    statusMessage: 'Cleared.'
  });
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

    const availableSignals = Object.values(signals)
      .filter((signal) => signal.isAvailable && Number.isFinite(signal.score));

    const frustrationScore = availableSignals.length > 0
      ? Math.round(availableSignals.reduce((sum, signal) => sum + signal.score, 0) / availableSignals.length)
      : 0;

    return {
      item,
      signals,
      frustrationScore
    };
  });
}

function getAvailableSignalsSorted(entry) {
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
    });
}

function getPrimarySignal(entry) {
  const availableSignals = getAvailableSignalsSorted(entry);
  return availableSignals[0] || entry.signals.lastUpdated;
}

function buildReasonFromSignal(signal) {
  if (signal.key === 'timeInColumn') {
    return `In this column for ${signal.rawValue}`;
  }

  return `Last updated ${signal.rawValue} ago`;
}

async function loadSentencesForSignal(signalKey) {
  if (sentencesCache[signalKey]) {
    return sentencesCache[signalKey];
  }

  try {
    const url = chrome.runtime.getURL(`sentences/${signalKey}.txt`);
    const response = await fetch(url);
    const text = await response.text();
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    sentencesCache[signalKey] = lines;
    return lines;
  } catch (error) {
    console.error(`Failed to load sentences for ${signalKey}:`, error);
    // Fallback to hardcoded sentences
    if (signalKey === 'timeInColumn') {
      return ['I have been stuck in this column for {duration}.'];
    }
    return ['Nobody has touched me for {duration}.'];
  }
}

function getToneCategory(frustrationScore) {
  if (frustrationScore <= 30) {
    return 'calm'; // lines 0-2 (indices 0, 1, 2)
  }
  if (frustrationScore <= 70) {
    return 'cheeky'; // lines 3-6 (indices 3, 4, 5, 6)
  }
  return 'serious'; // lines 7-9 (indices 7, 8, 9)
}

function getRandomSentenceForTone(sentences, tone) {
  let startIndex, endIndex;
  
  if (tone === 'calm') {
    startIndex = 0;
    endIndex = 2;
  } else if (tone === 'cheeky') {
    startIndex = 3;
    endIndex = 6;
  } else { // serious
    startIndex = 7;
    endIndex = 9;
  }
  
  // Ensure we don't go out of bounds
  endIndex = Math.min(endIndex, sentences.length - 1);
  startIndex = Math.min(startIndex, sentences.length - 1);
  
  const range = endIndex - startIndex + 1;
  const randomOffset = Math.floor(Math.random() * range);
  const selectedIndex = startIndex + randomOffset;
  
  return sentences[selectedIndex];
}

async function buildVoiceSentenceFromSignal(signal, frustrationScore) {
  const sentences = await loadSentencesForSignal(signal.key);
  const tone = getToneCategory(frustrationScore);
  const template = getRandomSentenceForTone(sentences, tone);
  
  // Replace {duration} placeholder with the actual speech value
  return template.replace('{duration}', signal.speechValue);
}

async function buildSpeechFromSignals(signals, title, frustrationScore) {
  const complaintSentences = await Promise.all(
    signals.map((signal) => buildVoiceSentenceFromSignal(signal, frustrationScore))
  );
  return [title, ...complaintSentences].join(' ');
}

function sortEntriesForPlayback(entries) {
  return [...entries].sort((a, b) => {
    if (b.frustrationScore !== a.frustrationScore) {
      return b.frustrationScore - a.frustrationScore;
    }

    const aPrimary = getPrimarySignal(a);
    const bPrimary = getPrimarySignal(b);

    if ((bPrimary.score || 0) !== (aPrimary.score || 0)) {
      return (bPrimary.score || 0) - (aPrimary.score || 0);
    }

    if ((bPrimary.durationMs || 0) !== (aPrimary.durationMs || 0)) {
      return (bPrimary.durationMs || 0) - (aPrimary.durationMs || 0);
    }

    return Number(a.item.id) - Number(b.item.id);
  });
}

async function navigateToTicket(index) {
  if (index < 0 || index >= runState.queue.length) {
    throw new Error('Invalid queue index.');
  }

  await clearCurrentHighlightIfAny();

  const entry = runState.queue[index];
  const id = entry.item.id;
  const title = entry.item.fields['System.Title'] || 'Untitled work item';
  
  // Get all available signals sorted by score and duration
  const voiceSignals = getAvailableSignalsSorted(entry);
  const primarySignal = getPrimarySignal(entry);

  setRunState({
    currentQueueIndex: index,
    currentHighlightedTicketId: id,
    currentTicket: {
      title,
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
    statusMessage: `Reading ticket ${index + 1} of ${runState.queue.length}`
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

  const speechText = await buildSpeechFromSignals(voiceSignals, title, entry.frustrationScore);
  await speak(speechText);
}

async function nextTicket() {
  if (!runState.isQueueLoaded) {
    throw new Error('No queue loaded. Start first.');
  }

  const nextIndex = runState.currentQueueIndex + 1;
  
  if (nextIndex >= runState.queue.length) {
    throw new Error('Already at last ticket.');
  }

  await navigateToTicket(nextIndex);
  return { ok: true, index: nextIndex };
}

async function previousTicket() {
  if (!runState.isQueueLoaded) {
    throw new Error('No queue loaded. Start first.');
  }

  const prevIndex = runState.currentQueueIndex - 1;
  
  if (prevIndex < 0) {
    throw new Error('Already at first ticket.');
  }

  await navigateToTicket(prevIndex);
  return { ok: true, index: prevIndex };
}

function filterItemsByTags(items, tagsToIgnore) {
  if (!tagsToIgnore || !tagsToIgnore.trim()) {
    return items;
  }

  // Parse the comma-separated tags to ignore into an array (lowercase, trimmed)
  const ignoredTags = tagsToIgnore
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(tag => tag.length > 0);

  if (ignoredTags.length === 0) {
    return items;
  }

  // Filter out items that have ANY of the ignored tags
  return items.filter(item => {
    const itemTags = item.fields['System.Tags'];
    
    if (!itemTags) {
      return true; // No tags on item, so keep it
    }

    // Azure DevOps tags are semicolon-separated
    const itemTagArray = itemTags
      .split(';')
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0);

    // Check if ANY ignored tag matches ANY item tag (OR logic)
    const hasIgnoredTag = itemTagArray.some(itemTag => 
      ignoredTags.includes(itemTag)
    );

    return !hasIgnoredTag; // Keep if no ignored tags found
  });
}

async function loadChatterBoard({ tabId, url }) {
  if (runState.isQueueLoaded) {
    throw new Error('Queue already loaded. Clear first.');
  }

  setRunState({
    isQueueLoaded: false,
    currentTabId: tabId,
    currentHighlightedTicketId: null,
    currentTicket: null,
    queue: [],
    currentQueueIndex: -1,
    statusMessage: 'Starting...'
  });

  try {
    if (!tabId || !url) {
      throw new Error('Missing tabId or url.');
    }

    const settings = await getRuntimeSettings();
    const {
      adoPat,
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

    if (!ids.length) {
      setRunState({
        isQueueLoaded: false,
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

    // Filter out items with tags to ignore
    const filteredItems = filterItemsByTags(items, settings.tagsToIgnore);

    if (!filteredItems.length) {
      setRunState({
        isQueueLoaded: false,
        statusMessage: 'All visible work items were filtered out by tag exclusions.'
      });
      await speak('All work items were filtered out.');
      return { ok: true, count: 0 };
    }

    const timeInColumnElapsedMap = await buildTimeInColumnElapsedMap({
      org: parsed.org,
      project: parsed.project,
      adoPat,
      items: filteredItems
    });

    const entries = buildSignalEntries(
      filteredItems,
      timeInColumnElapsedMap,
      scoringMode,
      absoluteScaleMaxDays
    );

    const sortedEntries = sortEntriesForPlayback(entries);
    const selected = sortedEntries.slice(0, maxTicketsToSpeak);

    if (!selected.length) {
      setRunState({
        isQueueLoaded: false,
        statusMessage: 'No active visible work items found.'
      });
      return { ok: true, count: 0 };
    }

    setRunState({
      isQueueLoaded: true,
      queue: selected,
      currentQueueIndex: -1
    });

    await navigateToTicket(0);
    
    return { ok: true, count: selected.length };
  } catch (error) {
    await clearCurrentHighlightIfAny();
    setRunState({
      isQueueLoaded: false,
      currentTabId: null,
      currentHighlightedTicketId: null,
      currentTicket: null,
      queue: [],
      currentQueueIndex: -1,
      statusMessage: `Error: ${error.message}`
    });
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LOAD_CHATTERBOARD') {
    loadChatterBoard({
      tabId: message.tabId,
      url: message.url
    })
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === 'NEXT_TICKET') {
    nextTicket()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === 'PREVIOUS_TICKET') {
    previousTicket()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === 'STOP_CHATTERBOARD') {
    try {
      stopChatterBoard();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return true;
  }

  if (message?.type === 'GET_CHATTERBOARD_STATE') {
    sendResponse({
      ok: true,
      state: {
        isQueueLoaded: runState.isQueueLoaded,
        currentTabId: runState.currentTabId,
        currentHighlightedTicketId: runState.currentHighlightedTicketId,
        currentTicket: runState.currentTicket,
        statusMessage: runState.statusMessage,
        queueLength: runState.queue.length,
        currentQueueIndex: runState.currentQueueIndex
      }
    });
    return true;
  }

  return false;
});
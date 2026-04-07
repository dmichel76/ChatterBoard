// ElevenLabs default premade voices available on the free tier
const FREE_ELEVENLABS_VOICES = [
  'JBFqnCBsd6RMkjVDRZzb', // George
  'EXAVITQu4vr4xnSDxMaL', // Sarah
  'IKne3meq5aSn9XLyUdCD', // Charlie
  'XB0fDUnXU5powFXDhCwa', // Charlotte
  'Xb7hH8MSUJpSbSDYk0k2', // Alice
  'XrExE9yKIg1WjnnlVkGX', // Matilda
  'N2lVS1w4EtoT3dr4eOWO', // Callum
  'TX3LPaxmHKxFdv7VOQHJ', // Liam
  'nPczCjzI2devNBz1zQrb', // Brian
  'onwK4e9ZLuTAKqWW03F9', // Daniel
  'pFZP5JQG7iQjIQuC4Bku', // Lily
  'bIHbv24MWmeRgasZH58o', // Will
  '9BWtsMINqrJLrRacOk9x', // Aria
  'CwhRBWXHgEUDjpjDnaoR', // Roger
  'FGY2WhTYpPnrIDTdsKH5', // Laura
];

const DEFAULT_MAX_TICKETS_TO_SPEAK = 5;
const DEFAULT_SCORING_MODE = 'relative';
const DEFAULT_ABSOLUTE_SCALE_MAX_DAYS = 30;
const WORK_ITEM_BATCH_SIZE = 200;
const WORK_ITEM_REVISIONS_TOP = 200;

const sentencesCache = {
  lastUpdated: null,
  timeInColumn: null,
  timeInProgress: null
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
  const [syncStored, localStored] = await Promise.all([
    chrome.storage.sync.get(['voiceEngine', 'speechMode', 'scoringMode', 'absoluteScaleMaxDays', 'maxTicketsToSpeak', 'tagsToIgnore']),
    chrome.storage.local.get(['adoPat', 'elevenLabsApiKey', 'openAiApiKey'])
  ]);
  const stored = { ...syncStored, ...localStored };

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
  const voiceEngine = stored.voiceEngine === 'ai' ? 'ai' : 'tts';
  // Strip any non-ASCII characters that would break HTTP headers
  const elevenLabsApiKey = (stored.elevenLabsApiKey || '').trim().replace(/[^\x20-\x7E]/g, '');
  const openAiApiKey = (stored.openAiApiKey || '').trim().replace(/[^\x20-\x7E]/g, '');
  const speechMode = stored.speechMode === 'ai' ? 'ai' : 'templates';
  const tagsToIgnore = (stored.tagsToIgnore || '').trim();

  return {
    adoPat,
    voiceEngine,
    elevenLabsApiKey,
    openAiApiKey,
    speechMode,
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

async function speakWithElevenLabs(text, apiKey, voiceId) {
  const resolvedVoiceId = voiceId || 'JBFqnCBsd6RMkjVDRZzb';

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ElevenLabs TTS API failed: HTTP ${response.status} ${response.statusText} — ${errorText}`);
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson?.detail?.code === 'payment_required') {
          return 'payment_required';
        }
      } catch (_) { /* not JSON, ignore */ }
      return false;
    }

    console.log('ElevenLabs: Audio received, sending to offscreen for playback...');
    const arrayBuffer = await response.arrayBuffer();
    const base64Audio = arrayBufferToBase64(arrayBuffer);

    return await playAudioViaOffscreen(base64Audio);
  } catch (error) {
    console.error('ElevenLabs TTS error:', error);
    return false;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function playAudioViaOffscreen(base64Audio) {
  // Ensure the offscreen document exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (!existingContexts.length) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Playing ElevenLabs TTS audio'
    });
  }

  return new Promise((resolve) => {
    const listener = (message) => {
      if (message.type === 'ELEVENLABS_PLAYBACK_DONE') {
        chrome.runtime.onMessage.removeListener(listener);
        // Intentional stop counts as success — don't fall back to Chrome TTS
        resolve(message.stopped ? true : message.success);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.runtime.sendMessage({
      type: 'PLAY_ELEVENLABS_AUDIO',
      base64Audio
    });
  });
}

function speakWithChromeTTS(text) {
  return new Promise((resolve) => {
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
          console.warn('Chrome TTS error:', event);
          resolve();
        }
      }
    });
  });
}

function pickVoiceForTicket(ticketId) {
  const numericId = parseInt(ticketId, 10);
  const index = Number.isFinite(numericId)
    ? numericId % FREE_ELEVENLABS_VOICES.length
    : Math.floor(Math.random() * FREE_ELEVENLABS_VOICES.length);
  return FREE_ELEVENLABS_VOICES[index];
}

async function speak(text, ticketId) {
  const settings = await getRuntimeSettings();

  // Try ElevenLabs if AI voice engine is selected and an API key is available
  if (settings.voiceEngine === 'ai' && settings.elevenLabsApiKey) {
    // If no manual voice override, pick a free premade voice based on ticket ID
    const voiceId = pickVoiceForTicket(ticketId);
    const elevenLabsResult = await speakWithElevenLabs(text, settings.elevenLabsApiKey, voiceId);
    
    if (elevenLabsResult === true) {
      return;
    }

    if (elevenLabsResult === 'payment_required') {
      setRunState({ statusMessage: 'ElevenLabs: free plan cannot use library voices via the API. Falling back to Chrome TTS.' });
    } else if (!speak.notifiedElevenLabsFailure) {
      console.warn('ElevenLabs TTS failed, falling back to Chrome TTS');
      speak.notifiedElevenLabsFailure = true;
    }
  }
  
  console.log('Using Chrome TTS fallback');
  // Fallback to Chrome TTS
  await speakWithChromeTTS(text);
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

async function stopCurrentSpeech() {
  chrome.tts.stop();
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length) {
    chrome.runtime.sendMessage({ type: 'STOP_ELEVENLABS_AUDIO' });
  }
}

function stopChatterBoard() {
  stopCurrentSpeech();
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

function getElapsedMsSinceStateChanged(item) {
  const stateChangeDate = item.fields['Microsoft.VSTS.Common.StateChangeDate'];
  if (!stateChangeDate) {
    return null;
  }
  const t = new Date(stateChangeDate).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Date.now() - t);
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

function buildTimeInStateElapsedMap(items) {
  const elapsedMap = new Map();
  items.forEach((item) => elapsedMap.set(item.id, getElapsedMsSinceStateChanged(item)));
  return elapsedMap;
}

function getSignalDefinitions(item, timeInColumnElapsedMap, timeInStateElapsedMap) {
  const lastUpdatedDurationMs = getElapsedMsSinceChanged(item);
  const timeInColumnDurationMs = timeInColumnElapsedMap.get(item.id);
  const timeInStateDurationMs = timeInStateElapsedMap.get(item.id);
  const currentState = item.fields['System.State'] || null;

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
      columnName: getBoardColumnFromFields(item.fields) || null,
      durationMs: timeInColumnDurationMs,
      rawValue: Number.isFinite(timeInColumnDurationMs)
        ? formatDurationShort(timeInColumnDurationMs)
        : 'Unknown',
      speechValue: Number.isFinite(timeInColumnDurationMs)
        ? formatDurationForSpeech(timeInColumnDurationMs)
        : null,
      isAvailable: Number.isFinite(timeInColumnDurationMs)
    },
    timeInProgress: {
      key: 'timeInProgress',
      label: currentState ? `In '${currentState}' state` : 'Time in state',
      durationMs: timeInStateDurationMs,
      rawValue: Number.isFinite(timeInStateDurationMs)
        ? formatDurationShort(timeInStateDurationMs)
        : 'Unknown',
      speechValue: Number.isFinite(timeInStateDurationMs)
        ? formatDurationForSpeech(timeInStateDurationMs)
        : null,
      isAvailable: Number.isFinite(timeInStateDurationMs)
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

function buildSignalEntries(items, timeInColumnElapsedMap, timeInProgressElapsedMap, scoringMode, absoluteScaleMaxDays) {
  const signalDefinitionsByItem = items.map((item) =>
    getSignalDefinitions(item, timeInColumnElapsedMap, timeInProgressElapsedMap)
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
  const sorted = Object.values(entry.signals)
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

  if (sorted.length === 0) {
    return sorted;
  }

  // Only speak signals that are at least 50% of the top signal's score.
  // This filters out weak signals when a much stronger one dominates.
  const topScore = sorted[0].score;
  return sorted.filter((signal) => signal.score >= topScore * 0.5);
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
    } else if (signalKey === 'timeInProgress') {
      return ['I have been in progress for {duration}.'];
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
  // Use predefined sentences
  const sentences = await loadSentencesForSignal(signal.key);
  const tone = getToneCategory(frustrationScore);
  const template = getRandomSentenceForTone(sentences, tone);
  
  // Replace {duration} and {column} placeholders with actual values
  const columnName = signal.columnName || 'this column';
  return template
    .replace('{duration}', signal.speechValue)
    .replace('{column}', columnName);
}

async function buildSpeechFromSignals(signals, title, frustrationScore) {
  const complaintSentences = await Promise.all(
    signals.map((signal) => buildVoiceSentenceFromSignal(signal, frustrationScore))
  );
  return [title, ...complaintSentences].join(' ');
}

function buildOpenAIPrompt(entry) {
  const title = entry.item.fields['System.Title'] || 'Untitled work item';
  const signals = getAvailableSignalsSorted(entry);
  const score = entry.frustrationScore;

  const toneMap = {
    low: 'mild and low-key',
    medium: 'concerned and direct',
    high: 'urgent and exasperated',
    critical: 'blunt and alarmed'
  };
  const tone = toneMap[getToneCategory(score)] || 'direct';

  const signalLines = signals
    .map((s) => {
      const columnNote = s.key === 'timeInColumn' && s.columnName ? ` (column: '${s.columnName}')` : '';
      return `- ${s.label}${columnNote}: ${s.rawValue} (frustration score: ${s.score}/100)`;
    })
    .join('\n');

  return `You are announcing a stale ticket during a team stand-up. Be concise, ${tone}, and speak naturally. Do not say "ticket", do not mention IDs or scores. Speak in 1–2 sentences maximum.

Ticket title: "${title}"
Frustration signals:
${signalLines}

Announce this ticket.`;
}

async function generateSpeechTextWithOpenAI(entry, apiKey) {
  try {
    const prompt = buildOpenAIPrompt(entry);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 120,
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API error: HTTP ${response.status} — ${errorText}`);
      return null;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (error) {
    console.error('OpenAI speech generation failed:', error);
    return null;
  }
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

  await stopCurrentSpeech();
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
          label: entry.signals.timeInColumn.columnName
            ? `In '${entry.signals.timeInColumn.columnName}' column`
            : entry.signals.timeInColumn.label,
          rawValue: entry.signals.timeInColumn.rawValue,
          score: entry.signals.timeInColumn.score,
          isAvailable: entry.signals.timeInColumn.isAvailable
        },
        timeInProgress: {
          label: entry.signals.timeInProgress.label,
          rawValue: entry.signals.timeInProgress.rawValue,
          score: entry.signals.timeInProgress.score,
          isAvailable: entry.signals.timeInProgress.isAvailable
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

  const speechText = entry.speechText
    || await buildSpeechFromSignals(voiceSignals, title, entry.frustrationScore);
  await speak(speechText, id);
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

    const timeInStateElapsedMap = buildTimeInStateElapsedMap(filteredItems);

    const entries = buildSignalEntries(
      filteredItems,
      timeInColumnElapsedMap,
      timeInStateElapsedMap,
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

    // Pre-generate AI speech text for all queued tickets in parallel
    if (settings.speechMode === 'ai' && settings.openAiApiKey) {
      setRunState({ statusMessage: 'Generating speech...' });
      const generated = await Promise.all(
        selected.map((entry) => generateSpeechTextWithOpenAI(entry, settings.openAiApiKey))
      );
      generated.forEach((text, i) => {
        if (text) {
          selected[i].speechText = text;
        }
      });
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
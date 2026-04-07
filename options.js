const DEFAULT_SETTINGS = {
  adoPat: '',
  openAiApiKey: '',
  speechMode: 'templates',
  voiceEngine: 'tts',
  elevenLabsApiKey: '',
  scoringMode: 'relative',
  absoluteScaleMaxDays: 30,
  maxTicketsToSpeak: 5,
  tagsToIgnore: ''
};

const fields = {
  adoPat: document.getElementById('adoPat'),
  openAiApiKey: document.getElementById('openAiApiKey'),
  speechMode: document.getElementById('speechMode'),
  voiceEngine: document.getElementById('voiceEngine'),
  elevenLabsApiKey: document.getElementById('elevenLabsApiKey'),
  scoringMode: document.getElementById('scoringMode'),
  absoluteScaleMaxDays: document.getElementById('absoluteScaleMaxDays'),
  maxTicketsToSpeak: document.getElementById('maxTicketsToSpeak'),
  tagsToIgnore: document.getElementById('tagsToIgnore')
};

const statusEl = document.getElementById('status');

function setStatus(message) {
  statusEl.textContent = message;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normaliseScoringMode(value) {
  return value === 'absolute' ? 'absolute' : 'relative';
}

function updateElevenLabsKeyState() {
  const isAi = fields.voiceEngine.value === 'ai';
  fields.elevenLabsApiKey.disabled = !isAi;
  fields.elevenLabsApiKey.style.opacity = isAi ? '' : '0.4';
  fields.elevenLabsApiKey.style.cursor = isAi ? '' : 'not-allowed';
}

function updateOpenAiKeyState() {
  const isAi = fields.speechMode.value === 'ai';
  fields.openAiApiKey.disabled = !isAi;
  fields.openAiApiKey.style.opacity = isAi ? '' : '0.4';
  fields.openAiApiKey.style.cursor = isAi ? '' : 'not-allowed';
}

fields.voiceEngine.addEventListener('change', updateElevenLabsKeyState);
fields.speechMode.addEventListener('change', updateOpenAiKeyState);

async function loadOptions() {
  const [syncStored, localStored] = await Promise.all([
    chrome.storage.sync.get(['speechMode', 'voiceEngine', 'scoringMode', 'absoluteScaleMaxDays', 'maxTicketsToSpeak', 'tagsToIgnore']),
    chrome.storage.local.get(['adoPat', 'openAiApiKey', 'elevenLabsApiKey'])
  ]);
  const stored = { ...syncStored, ...localStored };

  fields.adoPat.value = stored.adoPat || DEFAULT_SETTINGS.adoPat;
  fields.speechMode.value = stored.speechMode === 'ai' ? 'ai' : 'templates';
  fields.openAiApiKey.value = stored.openAiApiKey || DEFAULT_SETTINGS.openAiApiKey;
  updateOpenAiKeyState();
  fields.voiceEngine.value = stored.voiceEngine === 'ai' ? 'ai' : 'tts';
  fields.elevenLabsApiKey.value = stored.elevenLabsApiKey || DEFAULT_SETTINGS.elevenLabsApiKey;
  updateElevenLabsKeyState();
  fields.scoringMode.value = normaliseScoringMode(stored.scoringMode);
  fields.absoluteScaleMaxDays.value = clampNumber(
    stored.absoluteScaleMaxDays,
    1,
    3650,
    DEFAULT_SETTINGS.absoluteScaleMaxDays
  );
  fields.maxTicketsToSpeak.value = clampNumber(
    stored.maxTicketsToSpeak,
    1,
    50,
    DEFAULT_SETTINGS.maxTicketsToSpeak
  );
  fields.tagsToIgnore.value = stored.tagsToIgnore || DEFAULT_SETTINGS.tagsToIgnore;
}

async function saveOptions() {
  const adoPat = fields.adoPat.value.trim();
  const openAiApiKey = fields.openAiApiKey.value.trim().replace(/[^\x20-\x7E]/g, '');
  const speechMode = fields.speechMode.value === 'ai' ? 'ai' : 'templates';
  const voiceEngine = fields.voiceEngine.value === 'ai' ? 'ai' : 'tts';
  // Strip any non-ASCII characters that would break HTTP headers
  const elevenLabsApiKey = fields.elevenLabsApiKey.value.trim().replace(/[^\x20-\x7E]/g, '');
  const scoringMode = normaliseScoringMode(fields.scoringMode.value);
  const absoluteScaleMaxDays = clampNumber(
    fields.absoluteScaleMaxDays.value,
    1,
    3650,
    DEFAULT_SETTINGS.absoluteScaleMaxDays
  );
  const maxTicketsToSpeak = clampNumber(
    fields.maxTicketsToSpeak.value,
    1,
    50,
    DEFAULT_SETTINGS.maxTicketsToSpeak
  );
  const tagsToIgnore = fields.tagsToIgnore.value.trim();

  fields.scoringMode.value = scoringMode;
  fields.absoluteScaleMaxDays.value = String(absoluteScaleMaxDays);
  fields.maxTicketsToSpeak.value = String(maxTicketsToSpeak);
  fields.tagsToIgnore.value = tagsToIgnore;
  fields.elevenLabsApiKey.value = elevenLabsApiKey;

  await Promise.all([
    chrome.storage.local.set({ adoPat, openAiApiKey, elevenLabsApiKey }),
    chrome.storage.sync.set({ speechMode, voiceEngine, scoringMode, absoluteScaleMaxDays, maxTicketsToSpeak, tagsToIgnore })
  ]);

  setStatus('Saved.');
}

document.getElementById('saveButton').addEventListener('click', saveOptions);
loadOptions();
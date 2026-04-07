const DEFAULT_SETTINGS = {
  adoPat: '',
  voiceEngine: 'tts',
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '',
  scoringMode: 'relative',
  absoluteScaleMaxDays: 30,
  maxTicketsToSpeak: 5,
  tagsToIgnore: '',
  inProgressColumnName: ''
};

const fields = {
  adoPat: document.getElementById('adoPat'),
  voiceEngine: document.getElementById('voiceEngine'),
  elevenLabsApiKey: document.getElementById('elevenLabsApiKey'),
  elevenLabsVoiceId: document.getElementById('elevenLabsVoiceId'),
  scoringMode: document.getElementById('scoringMode'),
  absoluteScaleMaxDays: document.getElementById('absoluteScaleMaxDays'),
  maxTicketsToSpeak: document.getElementById('maxTicketsToSpeak'),
  tagsToIgnore: document.getElementById('tagsToIgnore'),
  inProgressColumnName: document.getElementById('inProgressColumnName')
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

async function loadOptions() {
  const stored = await chrome.storage.sync.get([
    'adoPat',
    'voiceEngine',
    'elevenLabsApiKey',
    'elevenLabsVoiceId',
    'scoringMode',
    'absoluteScaleMaxDays',
    'maxTicketsToSpeak',
    'tagsToIgnore',
    'inProgressColumnName'
  ]);

  fields.adoPat.value = stored.adoPat || DEFAULT_SETTINGS.adoPat;
  fields.voiceEngine.value = stored.voiceEngine === 'ai' ? 'ai' : 'tts';
  fields.elevenLabsApiKey.value = stored.elevenLabsApiKey || DEFAULT_SETTINGS.elevenLabsApiKey;
  fields.elevenLabsVoiceId.value = stored.elevenLabsVoiceId || DEFAULT_SETTINGS.elevenLabsVoiceId;
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
  fields.inProgressColumnName.value = stored.inProgressColumnName || DEFAULT_SETTINGS.inProgressColumnName;
}

async function saveOptions() {
  const adoPat = fields.adoPat.value.trim();
  const voiceEngine = fields.voiceEngine.value === 'ai' ? 'ai' : 'tts';
  // Strip any non-ASCII characters that would break HTTP headers
  const elevenLabsApiKey = fields.elevenLabsApiKey.value.trim().replace(/[^\x20-\x7E]/g, '');
  const elevenLabsVoiceId = fields.elevenLabsVoiceId.value.trim().replace(/[^\x20-\x7E]/g, '');
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
  const inProgressColumnName = fields.inProgressColumnName.value.trim();

  fields.scoringMode.value = scoringMode;
  fields.absoluteScaleMaxDays.value = String(absoluteScaleMaxDays);
  fields.maxTicketsToSpeak.value = String(maxTicketsToSpeak);
  fields.tagsToIgnore.value = tagsToIgnore;
  fields.inProgressColumnName.value = inProgressColumnName;
  fields.elevenLabsApiKey.value = elevenLabsApiKey;
  fields.elevenLabsVoiceId.value = elevenLabsVoiceId;

  await chrome.storage.sync.set({
    adoPat,
    voiceEngine,
    elevenLabsApiKey,
    elevenLabsVoiceId,
    scoringMode,
    absoluteScaleMaxDays,
    maxTicketsToSpeak,
    tagsToIgnore,
    inProgressColumnName
  });

  setStatus('Saved.');
}

document.getElementById('saveButton').addEventListener('click', saveOptions);
loadOptions();
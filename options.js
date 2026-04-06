const DEFAULT_SETTINGS = {
  adoPat: '',
  voiceSignalThreshold: 75,
  scoringMode: 'relative',
  absoluteScaleMaxDays: 30,
  maxTicketsToSpeak: 5,
  tagsToIgnore: ''
};

const fields = {
  adoPat: document.getElementById('adoPat'),
  voiceSignalThreshold: document.getElementById('voiceSignalThreshold'),
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

async function loadOptions() {
  const stored = await chrome.storage.sync.get([
    'adoPat',
    'voiceSignalThreshold',
    'scoringMode',
    'absoluteScaleMaxDays',
    'maxTicketsToSpeak',
    'tagsToIgnore'
  ]);

  fields.adoPat.value = stored.adoPat || DEFAULT_SETTINGS.adoPat;
  fields.voiceSignalThreshold.value = clampNumber(
    stored.voiceSignalThreshold,
    0,
    100,
    DEFAULT_SETTINGS.voiceSignalThreshold
  );
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
  const voiceSignalThreshold = clampNumber(
    fields.voiceSignalThreshold.value,
    0,
    100,
    DEFAULT_SETTINGS.voiceSignalThreshold
  );
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

  fields.voiceSignalThreshold.value = String(voiceSignalThreshold);
  fields.scoringMode.value = scoringMode;
  fields.absoluteScaleMaxDays.value = String(absoluteScaleMaxDays);
  fields.maxTicketsToSpeak.value = String(maxTicketsToSpeak);
  fields.tagsToIgnore.value = tagsToIgnore;

  await chrome.storage.sync.set({
    adoPat,
    voiceSignalThreshold,
    scoringMode,
    absoluteScaleMaxDays,
    maxTicketsToSpeak,
    tagsToIgnore
  });

  setStatus('Saved.');
}

document.getElementById('saveButton').addEventListener('click', saveOptions);
loadOptions();
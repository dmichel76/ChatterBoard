const DEFAULT_SETTINGS = {
  adoPat: '',
  scoringMode: 'relative',
  absoluteScaleMaxDays: 30,
  maxTicketsToSpeak: 5,
  tagsToIgnore: ''
};

const fields = {
  adoPat: document.getElementById('adoPat'),
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
    'scoringMode',
    'absoluteScaleMaxDays',
    'maxTicketsToSpeak',
    'tagsToIgnore'
  ]);

  fields.adoPat.value = stored.adoPat || DEFAULT_SETTINGS.adoPat;
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

  await chrome.storage.sync.set({
    adoPat,
    scoringMode,
    absoluteScaleMaxDays,
    maxTicketsToSpeak,
    tagsToIgnore
  });

  setStatus('Saved.');
}

document.getElementById('saveButton').addEventListener('click', saveOptions);
loadOptions();
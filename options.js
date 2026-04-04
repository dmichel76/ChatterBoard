const fields = {
  adoPat: document.getElementById('adoPat')
};

const statusEl = document.getElementById('status');

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadOptions() {
  const stored = await chrome.storage.sync.get(['adoPat']);
  fields.adoPat.value = stored.adoPat || '';
}

async function saveOptions() {
  const adoPat = fields.adoPat.value.trim();
  await chrome.storage.sync.set({ adoPat });
  setStatus('Saved.');
}

document.getElementById('saveButton').addEventListener('click', saveOptions);
loadOptions();
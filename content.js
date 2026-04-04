const FLASH_CLASS = 'chatterboard-flash';

(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .${FLASH_CLASS} {
      animation: chatterboardFlash 0.8s linear infinite;
      outline: 3px solid #d50000 !important;
      position: relative;
      z-index: 9999;
    }

    @keyframes chatterboardFlash {
      0% { background: rgba(213, 0, 0, 0.20); }
      50% { background: rgba(255, 255, 255, 0.95); }
      100% { background: rgba(213, 0, 0, 0.20); }
    }
  `;
  document.head.appendChild(style);
})();

function findCardElementsById(workItemId) {
  const selectors = [
    `[data-id="${workItemId}"]`,
    `[data-item-id="${workItemId}"]`,
    `[data-work-item-id="${workItemId}"]`,
    `[aria-label*="#${workItemId}"]`
  ];

  const matches = [];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => matches.push(node));
  });

  return [...new Set(matches)];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'HIGHLIGHT_TICKET') {
    const elements = findCardElementsById(message.workItemId);
    elements.forEach((el) => el.classList.add(FLASH_CLASS));
    sendResponse({ ok: true, count: elements.length });
    return true;
  }

  if (message?.type === 'CLEAR_HIGHLIGHT_TICKET') {
    const elements = findCardElementsById(message.workItemId);
    elements.forEach((el) => el.classList.remove(FLASH_CLASS));
    sendResponse({ ok: true, count: elements.length });
    return true;
  }

  return false;
});
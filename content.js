const FLASH_CLASS = 'chatterboard-flash';

(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .${FLASH_CLASS} {
      animation: chatterboardFlash 0.8s linear infinite !important;
      outline: 4px solid #d50000 !important;
      box-shadow: 0 0 0 4px rgba(213, 0, 0, 0.35) !important;
      background: rgba(213, 0, 0, 0.12) !important;
      border-radius: 6px !important;
      position: relative !important;
      z-index: 9999 !important;
    }

    @keyframes chatterboardFlash {
      0% {
        background: rgba(213, 0, 0, 0.18) !important;
        box-shadow: 0 0 0 4px rgba(213, 0, 0, 0.35) !important;
      }
      50% {
        background: rgba(255, 255, 255, 0.95) !important;
        box-shadow: 0 0 0 4px rgba(255, 0, 0, 0.6) !important;
      }
      100% {
        background: rgba(213, 0, 0, 0.18) !important;
        box-shadow: 0 0 0 4px rgba(213, 0, 0, 0.35) !important;
      }
    }
  `;
  document.head.appendChild(style);
})();

function findCardElementsById(workItemId) {
  const idText = String(workItemId);
  const matches = [];

  const directCard = document.querySelector(`div[data-itemid="${idText}"]`);
  if (directCard) {
    matches.push(directCard);
  }

  const link = document.querySelector(`a[href*="/_workitems/edit/${idText}"]`);
  if (link) {
    matches.push(
      link.closest('.wit-card') ||
      link.closest('.boards-card') ||
      link.closest('.card-content') ||
      link
    );
  }

  const span = [...document.querySelectorAll('span.font-weight-semibold.selectable-text')]
    .find((el) => el.textContent.trim() === idText);

  if (span) {
    matches.push(
      span.closest('.wit-card') ||
      span.closest('.boards-card') ||
      span.closest('.card-content') ||
      span
    );
  }

  return [...new Set(matches.filter(Boolean))];
}

function getCardColumnInfo(workItemId) {
  const elements = findCardElementsById(workItemId);
  const card = elements[0];

  if (!card) {
    return {
      found: false,
      isActiveColumn: false,
      reason: 'card_not_found'
    };
  }

  const column = card.closest('.kanban-board-column');
  if (!column) {
    return {
      found: true,
      isActiveColumn: false,
      reason: 'column_not_found'
    };
  }

  const row = column.parentElement;
  if (!row) {
    return {
      found: true,
      isActiveColumn: false,
      reason: 'row_not_found'
    };
  }

  const columns = [...row.children].filter((el) => el.classList?.contains('kanban-board-column'));
  const index = columns.indexOf(column);
  const lastIndex = columns.length - 1;

  if (index === -1) {
    return {
      found: true,
      isActiveColumn: false,
      reason: 'column_index_not_found'
    };
  }

  return {
    found: true,
    isActiveColumn: index > 0 && index < lastIndex,
    index,
    lastIndex,
    totalColumns: columns.length
  };
}

function scrollTicketIntoView(workItemId) {
  const elements = findCardElementsById(workItemId);
  const el = elements[0];

  if (!el) {
    return { ok: false, reason: 'not_found' };
  }

  el.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'center'
  });

  return { ok: true };
}

function getVisibleTicketIds() {
  const ids = new Set();

  document.querySelectorAll('div[data-itemid]').forEach((node) => {
    const value = node.getAttribute('data-itemid');
    if (value) {
      ids.add(String(value));
    }
  });

  document.querySelectorAll('a[href*="/_workitems/edit/"]').forEach((node) => {
    const match = node.getAttribute('href')?.match(/\/_workitems\/edit\/(\d+)/);
    if (match) {
      ids.add(match[1]);
    }
  });

  return [...ids];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'HIGHLIGHT_TICKET') {
    const elements = findCardElementsById(message.workItemId);
    console.log('HIGHLIGHT_TICKET', message.workItemId, elements);
    elements.forEach((el) => el.classList.add(FLASH_CLASS));
    sendResponse({ ok: true, count: elements.length });
    return true;
  }

  if (message?.type === 'CLEAR_HIGHLIGHT_TICKET') {
    const elements = findCardElementsById(message.workItemId);
    console.log('CLEAR_HIGHLIGHT_TICKET', message.workItemId, elements);
    elements.forEach((el) => el.classList.remove(FLASH_CLASS));
    sendResponse({ ok: true, count: elements.length });
    return true;
  }

  if (message?.type === 'IS_TICKET_IN_ACTIVE_COLUMN') {
    const info = getCardColumnInfo(message.workItemId);
    console.log('IS_TICKET_IN_ACTIVE_COLUMN', message.workItemId, info);
    sendResponse({ ok: true, ...info });
    return true;
  }

  if (message?.type === 'GET_VISIBLE_TICKET_IDS') {
    const ids = getVisibleTicketIds();
    sendResponse({ ok: true, ids });
    return true;
  }

  if (message?.type === 'SCROLL_TICKET_INTO_VIEW') {
  const result = scrollTicketIntoView(message.workItemId);
  sendResponse(result);
  return true;
}

  return false;
});
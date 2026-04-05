const FLASH_CLASS = 'chatterboard-flash';
const SNAPSHOT_TTL_MS = 400;

let snapshotCache = {
  value: null,
  createdAt: 0
};

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

function invalidateSnapshotCache() {
  snapshotCache.value = null;
  snapshotCache.createdAt = 0;
}

function getBoardRoot() {
  return (
    document.querySelector('.kanban-board') ||
    document.querySelector('.boards-kanban') ||
    document
  );
}

function getCardIdFromElement(cardEl) {
  if (!cardEl) {
    return null;
  }

  const directId = cardEl.getAttribute('data-itemid');
  if (directId) {
    return String(directId);
  }

  const link = cardEl.querySelector('a[href*="/_workitems/edit/"]');
  const match = link?.getAttribute('href')?.match(/\/_workitems\/edit\/(\d+)/);
  if (match) {
    return match[1];
  }

  return null;
}

function getColumnInfoForCard(cardEl) {
  if (!cardEl) {
    return {
      found: false,
      isActiveColumn: false,
      reason: 'card_not_found'
    };
  }

  const column = cardEl.closest('.kanban-board-column');
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
    reason: null,
    index,
    lastIndex,
    totalColumns: columns.length,
    column,
    row
  };
}

function createBoardSnapshot() {
  const boardRoot = getBoardRoot();
  const cardsById = new Map();
  const ticketIds = [];

  const cardElements = boardRoot.querySelectorAll('div[data-itemid]');

  cardElements.forEach((cardEl) => {
    const id = getCardIdFromElement(cardEl);
    if (!id || cardsById.has(id)) {
      return;
    }

    const columnInfo = getColumnInfoForCard(cardEl);

    cardsById.set(id, {
      id,
      cardEl,
      columnInfo
    });

    ticketIds.push(id);
  });

  return {
    boardRoot,
    cardsById,
    ticketIds
  };
}

function getBoardSnapshot({ forceRefresh = false } = {}) {
  const now = Date.now();
  const isFresh =
    snapshotCache.value &&
    now - snapshotCache.createdAt < SNAPSHOT_TTL_MS;

  if (!forceRefresh && isFresh) {
    return snapshotCache.value;
  }

  const snapshot = createBoardSnapshot();

  snapshotCache.value = snapshot;
  snapshotCache.createdAt = now;

  return snapshot;
}

function findCardElementsById(workItemId) {
  const idText = String(workItemId);
  const snapshot = getBoardSnapshot();
  const snapshotEntry = snapshot.cardsById.get(idText);

  if (snapshotEntry?.cardEl) {
    return [snapshotEntry.cardEl];
  }

  const fallbackMatches = [];
  const boardRoot = snapshot.boardRoot || document;

  const link = boardRoot.querySelector(`a[href*="/_workitems/edit/${idText}"]`);
  if (link) {
    fallbackMatches.push(
      link.closest('div[data-itemid]') ||
      link.closest('.wit-card') ||
      link.closest('.boards-card') ||
      link.closest('.card-content') ||
      link
    );
  }

  return [...new Set(fallbackMatches.filter(Boolean))];
}

function getCardColumnInfo(workItemId) {
  const idText = String(workItemId);
  const snapshot = getBoardSnapshot();
  const snapshotEntry = snapshot.cardsById.get(idText);

  if (snapshotEntry) {
    const { columnInfo } = snapshotEntry;
    return {
      found: columnInfo.found,
      isActiveColumn: columnInfo.isActiveColumn,
      reason: columnInfo.reason,
      index: columnInfo.index,
      lastIndex: columnInfo.lastIndex,
      totalColumns: columnInfo.totalColumns
    };
  }

  const fallbackElements = findCardElementsById(idText);
  const fallbackCard = fallbackElements[0];

  if (!fallbackCard) {
    return {
      found: false,
      isActiveColumn: false,
      reason: 'card_not_found'
    };
  }

  const info = getColumnInfoForCard(fallbackCard);
  return {
    found: info.found,
    isActiveColumn: info.isActiveColumn,
    reason: info.reason,
    index: info.index,
    lastIndex: info.lastIndex,
    totalColumns: info.totalColumns
  };
}

function expandSwimlaneForElement(el) {
  const swimlaneRow = el.closest('.kanban-board-row');

  if (!swimlaneRow) {
    return { ok: true, changed: false, reason: 'no_swimlane' };
  }

  if (swimlaneRow.classList.contains('expanded')) {
    return { ok: true, changed: false, reason: 'already_expanded' };
  }

  const header = swimlaneRow.querySelector('.kanban-board-row-header');
  if (!header) {
    return { ok: false, changed: false, reason: 'swimlane_header_not_found' };
  }

  header.click();
  invalidateSnapshotCache();
  return { ok: true, changed: true, reason: 'expanded' };
}

function scrollTicketIntoView(workItemId) {
  const elements = findCardElementsById(workItemId);
  const el = elements[0];

  if (!el) {
    return { ok: false, reason: 'not_found' };
  }

  const expansion = expandSwimlaneForElement(el);

  setTimeout(() => {
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });
  }, expansion.changed ? 250 : 0);

  return { ok: true, expansion };
}

function getVisibleTicketIds() {
  const snapshot = getBoardSnapshot();
  return [...snapshot.ticketIds];
}

function getActiveVisibleTicketIds() {
  const snapshot = getBoardSnapshot();

  return snapshot.ticketIds.filter((id) => {
    const entry = snapshot.cardsById.get(id);
    return !!entry?.columnInfo?.isActiveColumn;
  });
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

  if (message?.type === 'IS_TICKET_IN_ACTIVE_COLUMN') {
    const info = getCardColumnInfo(message.workItemId);
    sendResponse({ ok: true, ...info });
    return true;
  }

  if (message?.type === 'GET_VISIBLE_TICKET_IDS') {
    const ids = getVisibleTicketIds();
    sendResponse({ ok: true, ids });
    return true;
  }

  if (message?.type === 'GET_ACTIVE_VISIBLE_TICKET_IDS') {
    const ids = getActiveVisibleTicketIds();
    sendResponse({ ok: true, ids });
    return true;
  }

  if (message?.type === 'SCROLL_TICKET_INTO_VIEW') {
    const result = scrollTicketIntoView(message.workItemId);
    sendResponse(result);
    return true;
  }

  if (message?.type === 'REFRESH_BOARD_SNAPSHOT') {
    const snapshot = getBoardSnapshot({ forceRefresh: true });
    sendResponse({
      ok: true,
      count: snapshot.ticketIds.length
    });
    return true;
  }

  return false;
});
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
        } else if (
          event.type === 'error' ||
          event.type === 'interrupted' ||
          event.type === 'cancelled'
        ) {
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

async function runWiqlQuery({ org, project, adoPat }) {
  const wiql = {
    query: `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.TeamProject] = '${project}'
      ORDER BY [System.ChangedDate] ASC
    `
  };

  const response = await fetch(
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(':' + adoPat)
      },
      body: JSON.stringify(wiql)
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ADO WIQL failed: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.json();
}

async function fetchWorkItems({ org, project, adoPat, ids }) {
  const response = await fetch(
    `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(',')}&api-version=7.0`,
    {
      headers: {
        'Authorization': 'Basic ' + btoa(':' + adoPat)
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ADO workitems failed: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.json();
}

function scoreWorkItem(item) {
  const changedDate = item.fields['System.ChangedDate'];

  if (!changedDate) {
    return { score: 0, ageDays: 0 };
  }

  const ageMs = Date.now() - new Date(changedDate).getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  return {
    score: ageDays > 2 ? 1 : 0,
    ageDays
  };
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


chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'RUN_CHATTERBOARD') {
    (async () => {
      const tabId = message.tabId;
      const url = message.url;

      if (!tabId || !url) {
        sendResponse({ ok: false, error: 'Missing tabId or url.' });
        return;
      }

      const stored = await chrome.storage.sync.get(['adoPat']);
      const adoPat = (stored.adoPat || '').trim();

      if (!adoPat) {
        sendResponse({ ok: false, error: 'No Azure DevOps PAT found in Options.' });
        return;
      }

      const parsed = parseAdoUrl(url);
      if (!parsed) {
        sendResponse({ ok: false, error: 'Could not parse organisation and project from the URL.' });
        return;
      }

      const data = await runWiqlQuery({
        org: parsed.org,
        project: parsed.project,
        adoPat
      });

      const visibleResponse = await sendTabMessage(tabId, {
        type: 'GET_VISIBLE_TICKET_IDS'
      });

      const visibleIds = new Set((visibleResponse?.ids || []).map(String));

      const ids = (data.workItems || [])
        .map((item) => item.id)
        .filter((id) => visibleIds.has(String(id)))
        .slice(0, 40);

      if (!ids.length) {
        await speak('No work items found.');
        sendResponse({ ok: true, count: 0 });
        return;
      }

      const workItemsData = await fetchWorkItems({
        org: parsed.org,
        project: parsed.project,
        adoPat,
        ids
      });

      const items = workItemsData.value || [];

      const scored = items.map((item) => {
        const result = scoreWorkItem(item);
        return {
          item,
          score: result.score,
          ageDays: result.ageDays
        };
      });

      scored.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.ageDays - a.ageDays;
      });

      const selected = [];

      for (const entry of scored) {
        const id = entry.item.id;

        try {
          const placement = await sendTabMessage(tabId, {
            type: 'IS_TICKET_IN_ACTIVE_COLUMN',
            workItemId: id
          });

          if (placement?.isActiveColumn) {
            selected.push(entry);
          }
        } catch (error) {
          console.warn('Could not inspect ticket column placement', id, error);
        }

        if (selected.length >= 5) {
          break;
        }
      }

      if (!selected.length) {
        await speak('No active tickets found outside the first and last columns.');
        sendResponse({ ok: true, count: 0 });
        return;
      }

      for (const entry of selected) {
        const id = entry.item.id;
        const title = entry.item.fields['System.Title'] || 'Untitled work item';

        try {
          await sendTabMessage(tabId, {
            type: 'SCROLL_TICKET_INTO_VIEW',
            workItemId: id
          });
        } catch (error) {
          console.warn('Scroll failed', id, error);
        }

        try {
          await sendTabMessage(tabId, {
            type: 'HIGHLIGHT_TICKET',
            workItemId: id
          });
        } catch (error) {
          console.warn('Highlight failed', id, error);
        }

        await speak(`Ticket ${id}. No update for ${entry.ageDays} days. ${title}`);

        try {
          await sendTabMessage(tabId, {
            type: 'CLEAR_HIGHLIGHT_TICKET',
            workItemId: id
          });
        } catch (error) {
          console.warn('Clear highlight failed', id, error);
        }
      }

      sendResponse({ ok: true, count: selected.length });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });

    return true;
  }

  return false;
});
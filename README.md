# ChatterBoard MVP

ChatterBoard is a Chrome extension prototype that gives Azure DevOps tickets a voice.

The idea is simple: identify tickets that may need attention, bring them into view on the board, highlight them, and read them out loud so teams notice them during board reviews or stand-up.

This is an early MVP, built to validate the core interaction rather than provide a polished product.

---

## What it does today

The current prototype can:

- load as a Chrome extension
- run on Azure DevOps board pages
- store an Azure DevOps PAT in the extension options
- call the Azure DevOps REST API
- retrieve work items from the current project
- limit analysis to tickets currently visible on the board
- exclude tickets in the first and last board columns
- score tickets using a simple rule based on age since last update
- pick a small number of candidate tickets
- scroll each ticket into view
- highlight the matching card on the board
- read the ticket out loud using Chrome TTS

At the moment, the spoken message includes:
- ticket ID
- days since last update
- ticket title

Example:

> Ticket 1106429. No update for 4 days. Android - Unable to focus/select the save icon when using TalkBack.

---

## Current MVP behaviour

When the user clicks **Play**:

1. ChatterBoard reads the current Azure DevOps page context
2. It queries Azure DevOps for work items in the current project
3. It keeps only items that are visible on the current board
4. It excludes tickets in the first and last visible columns
5. It selects the oldest candidates based on last update date
6. It scrolls each selected ticket into view
7. It highlights the card
8. It speaks the ticket details

---

## What it does not do yet

This is still an MVP scaffold, so several important parts are not implemented yet.

Not done yet:

- blocked ticket detection
- effort-based scoring
- age since creation
- age in current state
- age in current column
- bounce / backflow detection
- dynamic phrase generation
- ElevenLabs voice output
- configuration of thresholds
- pricing, trial, or licensing logic
- Jira support

---

## Tech approach

Current implementation:

- **Chrome extension**
- **Azure DevOps REST API**
- **Chrome TTS**
- **Content script** for DOM interaction
- **Background script** for API calls and orchestration

### Current split of responsibilities

- `popup.js`  
  Starts the flow when the user clicks Play

- `background.js`  
  Reads settings, calls Azure DevOps, scores tickets, sequences speech/highlighting

- `content.js`  
  Finds cards in the DOM, checks visible tickets, checks column position, scrolls, highlights

- `options.js`  
  Stores and retrieves the Azure DevOps PAT

---

## Setup

### 1. Load the extension

1. Open Chrome
2. Go to `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Select the extension folder

### 2. Configure Azure DevOps access

Open the extension **Options** page and enter:

- **Azure DevOps PAT**

Minimum required scope:

- **Work Items (Read)**

### 3. Use it

1. Open an Azure DevOps board page
2. Click the extension
3. Press **Play**

---

## Current limitations

A few things are intentionally rough at this stage:

- board detection is based on the current Azure DevOps page structure
- DOM selectors are tailored to the current observed board HTML
- board column logic is hardcoded to ignore first and last visible columns
- scoring is still very basic
- only a small number of tickets are read out for debugging and iteration
- the extension currently uses Chrome TTS rather than ElevenLabs

---

## Why this exists

The goal is to test whether a board can become more actionable if work items speak for themselves.

Rather than relying only on dashboards, reports, or people noticing stale cards manually, ChatterBoard tries to create a lightweight behavioural nudge directly inside the board.

---

## Next planned steps

Likely next improvements:

- improve scoring beyond last update date
- add blocked ticket detection
- add more nuanced phrasing
- make ticket selection more flow-aware
- improve board matching robustness
- optionally switch from Chrome TTS to ElevenLabs
- add basic configuration for thresholds

---

## Status

Working prototype.

Core loop is now functional:
- retrieve tickets
- filter to visible board items
- exclude first/last column
- scroll
- highlight
- speak
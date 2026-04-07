# ChatterBoard

ChatterBoard is a Chrome extension that gives Azure DevOps tickets a voice.

It identifies tickets that may need attention, brings them into view on the board, highlights them, and reads them out loud — useful during board reviews or stand-up.

---

## What it does

- Loads as a Chrome extension on any Azure DevOps board page
- Queries the Azure DevOps REST API for work items in the current project
- Limits analysis to tickets currently visible on the board
- Excludes tickets in the first and last board columns
- Scores each ticket using up to three frustration signals
- Sorts tickets by frustration score and queues them for playback
- Scrolls each ticket into view and highlights the card
- Reads the ticket aloud using either Chrome TTS or ElevenLabs AI voices

---

## Frustration signals

Each ticket is scored on up to three signals. Signals scoring below 50% of the strongest signal are silenced — so if one signal clearly dominates, the others are not mentioned.

| Signal | What it measures |
|---|---|
| **Time since last updated** | How long since any change was made to the ticket |
| **Time in column** | How long the ticket has been in its current board column |
| **Time in progress** | How long since the ticket entered the configured in-progress column |

Scoring can be **relative** (compared against the worst ticket currently on the board) or **absolute** (compared against a fixed number of days).

---

## Voice options

ChatterBoard supports two voice engines, switchable from the Options page:

- **Chrome built-in TTS** — works out of the box, no configuration needed
- **ElevenLabs AI voices** — realistic AI voices using the ElevenLabs API. When no specific Voice ID is set, each ticket is automatically assigned a different free-tier voice based on its ticket ID, so the board feels varied. You can pin a single voice by entering a Voice ID.

---

## spoken output

For each ticket, ChatterBoard speaks:
- The ticket title
- One sentence per strong frustration signal, with phrasing that varies based on the severity (tone-matched from a curated sentence list)

Example:

> Android - Unable to focus the save icon when using TalkBack. This one has been gathering dust for 3 weeks and nobody's touched it.

---

## Setup

### 1. Load the extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

### 2. Configure

Open the extension **Options** page and set:

| Setting | Required | Description |
|---|---|---|
| Azure DevOps PAT | Yes | Minimum scope: Work Items (Read) |
| Voice engine | — | Chrome TTS (default) or ElevenLabs |
| ElevenLabs API Key | If using AI voices | From elevenlabs.io |
| ElevenLabs Voice ID | No | Leave blank to assign voices automatically |
| Scoring mode | — | Relative or Absolute |
| Absolute scale max days | If absolute mode | Days that map to a score of 100 (default: 30) |
| Maximum tickets spoken | — | How many tickets to queue per run (default: 5) |
| Tags to ignore | No | Comma-separated tags — matching tickets are skipped |
| In-progress column name | No | Column name used for the time-in-progress signal |

### 3. Use it

1. Open an Azure DevOps board page
2. Click the ChatterBoard extension icon
3. Press **Play** to load and speak the queue
4. Use **Next** / **Prev** to navigate manually
5. Press **Clear** to reset

---

## File structure

| File | Purpose |
|---|---|
| `background.js` | API calls, scoring, speech orchestration |
| `content.js` | DOM interaction — finds cards, scrolls, highlights |
| `popup.js` / `popup.html` | Extension popup UI |
| `options.js` / `options.html` | Settings page |
| `offscreen.js` / `offscreen.html` | Audio playback context for ElevenLabs (required by Chrome MV3) |
| `sentences/` | Tone-matched sentence templates for each frustration signal |

---

## Status

Working prototype. Core loop is functional end-to-end.

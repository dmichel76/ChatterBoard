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
- Generates unique narrations per ticket using OpenAI GPT-4o-mini (optional)

---

## Frustration signals

Each ticket is scored on up to three signals. Signals scoring below 50% of the strongest signal are silenced — so if one signal clearly dominates, the others are not mentioned.

| Signal | What it measures |
|---|---|
| **Time since last updated** | How long since any change was made to the ticket |
| **Time in column** | How long the ticket has been in its current board column (column name shown) |
| **Time in progress** | How long since the ticket entered the configured in-progress column |

Scoring can be **relative** (compared against the worst ticket currently on the board) or **absolute** (compared against a fixed number of days).

---

## Speech text

ChatterBoard supports two modes for generating what gets spoken, switchable directly from the popup:

- **Templates** (default) — curated tone-matched sentences, no API key needed. Phrasing scales from mild to alarmed based on frustration score. Includes the column name where relevant.
- **AI-generated** — unique narration per ticket using OpenAI GPT-4o-mini. All queued tickets are generated in parallel before playback starts. Falls back to templates if OpenAI is unavailable.

---

## Voice options

Two voice engines, switchable directly from the popup:

- **Chrome built-in TTS** (default) — works out of the box, no configuration needed
- **ElevenLabs AI voices** — realistic AI voices using the ElevenLabs API. Each ticket is automatically assigned a different free-tier voice based on its ticket ID so the board feels varied. You can pin a single voice by entering a Voice ID in Options.

---

## Popup mode pills

The popup shows four clickable pills at the bottom:

`Templates` · `AI text` · `Chrome TTS` · `AI voice`

The active mode is highlighted blue; the inactive option is greyed out. Click any pill to switch modes instantly without opening Options.

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
| OpenAI API Key | If using AI text | From platform.openai.com |
| Speech text mode | — | Templates (default) or AI-generated |
| Voice engine | — | Chrome TTS (default) or ElevenLabs |
| ElevenLabs API Key | If using AI voices | From elevenlabs.io |
| ElevenLabs Voice ID | No | Leave blank to assign voices automatically per ticket |
| Scoring mode | — | Relative or Absolute |
| Absolute scale max days | If absolute mode | Days that map to a score of 100 (default: 30) |
| Maximum tickets spoken | — | How many tickets to queue per run (default: 5) |
| Tags to ignore | No | Comma-separated tags — matching tickets are skipped |
| In-progress column name | No | Column name used for the time-in-progress signal |

### 3. Use it

1. Open an Azure DevOps board page
2. Click the ChatterBoard extension icon
3. Press **Start** to load and speak the queue
4. Use **Next** / **Previous** to navigate manually
5. Press **Clear** to reset
6. Click the mode pills to switch between Templates/AI text or Chrome TTS/AI voice on the fly

---

## File structure

| File | Purpose |
|---|---|
| `background.js` | API calls, scoring, speech orchestration, OpenAI generation |
| `content.js` | DOM interaction — finds cards, scrolls, highlights |
| `popup.js` / `popup.html` | Extension popup UI with mode pills |
| `options.js` / `options.html` | Settings page |
| `offscreen.js` / `offscreen.html` | Audio playback context for ElevenLabs (required by Chrome MV3) |
| `sentences/` | Tone-matched sentence templates for each frustration signal |

---

## Status

Working prototype. Core loop is functional end-to-end.

# ChatterBoard MVP

ChatterBoard is a Chrome extension prototype that gives work tickets a voice.

The idea is simple: surface flow problems directly from the board, highlight the relevant ticket, and make the work speak in a way that is visible, immediate, and hard to ignore.

This is an early MVP scaffold, not a finished product.

---

## Current status

The extension currently provides the basic technical foundation needed for the MVP.

### What it does right now

- Loads as a Chrome extension
- Runs on Azure DevOps pages
- Provides a popup with a **Play** button
- Provides an Options page with Azure DevOps PAT storage
- Reads the Azure DevOps PAT from extension storage
- Uses Chrome's built-in text-to-speech via `chrome.tts`
- Confirms the PAT is present by speaking:

> "PAT found. ChatterBoard is ready."

- Injects a content script into Azure DevOps pages
- Supports highlighting work item cards in the page by work item ID
- Keeps speech in the background script and DOM manipulation in the content script

### What is working technically

- popup → background messaging
- background → content script messaging
- PAT storage and retrieval
- Chrome TTS speech
- content-script-based ticket highlighting infrastructure

---

## What it does **not** do yet

The extension does **not yet** perform the core ChatterBoard workflow.

That means it does **not yet**:

- call the Azure DevOps REST API
- retrieve work items from the current project or team
- score tickets
- detect old, blocked, or neglected tickets
- select the worst 5 tickets
- highlight real tickets based on API results
- speak ticket-specific messages
- use ElevenLabs
- support pricing, licensing, or trial logic

---

## MVP vision

The intended MVP behaviour is:

1. User opens an Azure DevOps board
2. User clicks **Play**
3. ChatterBoard retrieves work items relevant to that context
4. ChatterBoard scores tickets based on simple flow rules
5. ChatterBoard selects the worst 5 tickets
6. Each selected ticket is highlighted on the board
7. Each selected ticket speaks a short sentence

The goal is to create a lightweight behavioural nudge, not a reporting dashboard.

---

## Planned MVP scoring criteria

The initial scoring model is expected to include simple, absolute rules such as:

- old since creation
- old since last update
- blocked
- effort or ticket size

More advanced criteria may come later.

---

## Planned future behaviour

### Azure DevOps integration
- Call Azure DevOps REST API using the stored PAT
- Infer organisation and project from the current Azure DevOps URL
- Retrieve work items via WIQL
- Later refine scoping to team-level board context

### Ticket scoring
- Score tickets using simple MVP rules first
- Later include richer flow signals such as:
  - time in current state
  - time in current column
  - bounce / backflow
  - inactivity
  - effort weighting

### Board interaction
- Highlight matching cards on the board while they are being spoken
- Improve DOM selectors once tested against real board HTML

### Voice
- Use Chrome TTS for early testing
- Later switch to ElevenLabs for more expressive voice output
- Eventually support more emotional or severity-based tone

### Productisation
- Introduce usage limits
- Add free trial logic
- Add paid plans
- Add billing / licensing model
- Potentially support Jira later

---

## Current limitations

This is still a starter implementation, so several parts are intentionally incomplete.

### Known limitations
- No Azure DevOps API call yet
- No real ticket retrieval yet
- No scoring yet
- No real ticket speech yet
- No team-specific scoping yet
- Highlighting selectors are best-effort and may need adapting to actual Azure DevOps board HTML
- No ElevenLabs integration in use at the moment
- No account, billing, or trial handling
- PAT is stored in extension storage, which is acceptable for a private MVP but not ideal for a polished product

---

## How to load the extension

1. Open Chrome
2. Go to `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Select the extension folder

If the extension has already been loaded and you make code changes:
- reload the extension in `chrome://extensions`
- refresh the Azure DevOps tab as well, so the latest content script is injected

---

## How to configure it

Open the extension **Options** page and set:

- **Azure DevOps PAT**

Minimum required scope for MVP:
- **Work Items (Read)**

---

## Current development approach

The MVP is being built incrementally.

The current priority is:

1. keep the extension clean and stable
2. validate Azure DevOps API connectivity
3. retrieve real work items
4. add scoring
5. connect scoring to highlighting and speech
6. only then add richer voice and product features

---

## Suggested next steps

1. Add the first Azure DevOps WIQL query
2. Retrieve a small set of work item IDs from the current project
3. Fetch ticket details for those IDs
4. Speak simple ticket information
5. Add first-pass scoring
6. Highlight the selected tickets
7. Replace generic speech with ticket-specific lines
8. Reintroduce ElevenLabs later, once the logic is proven

---

## Principle for this MVP

Start simple.  
Make the plumbing work first.  
Only add sophistication once the core loop is reliable.

# ChatterBoard MVP

This is a starter Chrome extension for the ChatterBoard idea.

## What it currently does

- Runs on Azure DevOps pages
- Reads an Azure DevOps team context from the URL when possible
- Calls the Azure DevOps REST API using a PAT
- Scores tickets using simple MVP rules:
  - old since creation (> 5 days)
  - old since last update (> 2 days)
  - blocked tag
  - large effort (>= 8)
- Selects the top 5 tickets
- Highlights matching ticket cards in the page
- Sends one sentence per ticket to ElevenLabs and plays the audio

## Important limitations

This is a starter implementation, not a finished product.

Things that are still rough:

- URL-to-team inference assumes a board URL pattern
- WIQL scoping is basic and may need refining for your ADO setup
- DOM selectors for card highlighting are best-effort only and may need adapting to your board HTML
- State age and column age are not implemented yet
- No billing, licensing, or trial logic yet
- API keys are stored in extension storage, which is okay for a private MVP but not a polished product

## How to load it

1. Open Chrome
2. Go to `chrome://extensions`
3. Turn on Developer mode
4. Click **Load unpacked**
5. Select this folder

## How to configure it

Open the extension options and set:

- Azure DevOps PAT
- blocked tag text, default `blocked`
- effort field reference name, default `Microsoft.VSTS.Scheduling.Effort`
- ElevenLabs API key
- ElevenLabs voice ID

## Suggested next steps

1. Validate the ADO API query against your own board
2. Refine ticket scoping so it really matches the team board
3. Confirm the DOM selectors needed to highlight cards reliably
4. Add fallback browser speech synthesis so ElevenLabs is optional for local testing
5. Add state age and column age once API validation is complete

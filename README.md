# Final-ASMR Playwright Test

An isolated proof-of-work repository. It does not modify either existing ASMR repository.

## First test scope

- Launch real Chrome using a dedicated persistent Playwright profile.
- Preserve cookies and sign-in between runs.
- Open the supplied Google Flow project URL.
- Save a screenshot and visible page text for inspection.
- Do not inject an extension, click Generate, or guess Flow selectors in this first diagnostic pass.

This verifies browser launch, profile persistence, navigation, and page observability before Flow-specific controls are implemented.

## Requirements

- Windows 10/11
- Node.js 20+
- Google Chrome installed
- A Google Flow project URL

## Setup

```powershell
npm install
npm run install:browsers
```

## Run

```powershell
$env:FLOW_PROJECT_URL="https://flow.google.com/project/YOUR_PROJECT_ID"
npm run inspect
```

On first launch, sign in to Google manually if required. The browser profile is stored in `profiles/account-01` and reused on later runs.

When the Flow project is loaded, press Enter in the terminal. The harness writes:
- `artifacts/flow-inspection.png`
- `artifacts/flow-visible-text.txt`

Do not share inspection output publicly if it contains private project information.

## What this test does not claim

This is not yet an end-to-end generation/download test. Flow's UI selectors and export workflow must be inspected and verified against the actual page before those actions are automated.

# Final-ASMR Playwright Test

An isolated five-account proof-of-work harness. It does not modify either existing ASMR repository.

## What it implements

- Five independent persistent Chrome profiles (one per Google account).
- Five independently assigned Google Flow project URLs.
- Five prompts, one per account.
- Concurrent browser launch and prompt submission.
- Independent monitoring for playable generated video elements.
- Download menu selection targeting **720p Original size**.
- Download completion and file-size validation.
- Per-account status and errors in `job.json`.
- Failure screenshots in `artifacts/`.
- Browser windows remain open after the run for inspection.

## Important verification boundary

Playwright is an established browser automation framework, but Flow's live UI can change. The prompt editor, Generate button, generated-video action menu and export menu are located using accessible roles/text and generic DOM fallbacks. The complete Flow workflow has **not** been live-verified in this repository yet. A selector mismatch will be recorded as an account error rather than silently treated as success.

This harness does not attempt to bypass Google's security checks or hide automation.

## Requirements

- Windows 10/11
- Node.js 20+
- Google Chrome installed

## Setup

```powershell
npm install
npm run install:browsers
Copy-Item config/accounts.example.json config/accounts.json
Copy-Item prompts.example.json prompts.json
```

Edit `config/accounts.json` and replace each placeholder with the corresponding Flow project URL. Edit `prompts.json` with the topic and five prompts.

## Run

```powershell
npm run check
npm run
```

Run the automation with:

```powershell
npm run run
```

On first launch, sign in manually to each Google account in its own Chrome profile if requested. Each profile is stored under `profiles/account-01` through `profiles/account-05` and persists between runs.

## Output

```
output/
  <Topic> - <job-id>/
    prompts/
      prompt_01.txt ... prompt_05.txt
    videos/
      account-01.mp4 ... account-05.mp4
    job.json
artifacts/
  account-XX-failure.png
```

The actual extension is taken from Chrome's suggested download filename. Failed accounts are recorded in `job.json`; completed downloads are not repeated automatically by this first test runner.

## Diagnostics

The earlier one-profile inspector is still available:

```powershell
$env:FLOW_PROJECT_URL="https://flow.google.com/project/YOUR_PROJECT_ID"
npm run inspect
```

It saves a screenshot and visible page text under `artifacts/`.

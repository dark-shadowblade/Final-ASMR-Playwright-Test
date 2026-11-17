import { chromium } from "playwright";
import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = process.cwd();
const PROFILE_ROOT = path.join(ROOT, "profiles");
const OUTPUT_ROOT = path.join(ROOT, "output");
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");
const JOB_ID = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function loadJson(file) {
  return JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
}

async function firstVisible(locators) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = locator.nth(i);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  return null;
}

async function findPromptEditor(page) {
  return firstVisible([
    page.getByRole("textbox"),
    page.locator("textarea"),
    page.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[contenteditable="true"]')
  ]);
}

async function fillPrompt(page, prompt) {
  const editor = await findPromptEditor(page);
  if (!editor) throw new Error("Could not identify a visible Flow prompt editor. No prompt was submitted.");
  await editor.click();
  const tag = await editor.evaluate(el => el.tagName.toLowerCase());
  if (tag === "textarea" || tag === "input") await editor.fill(prompt);
  else {
    await editor.fill(prompt).catch(async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.insertText(prompt);
    });
  }
}

async function clickGenerate(page) {
  const candidates = [
    page.getByRole("button", { name: /^generate$/i }),
    page.getByRole("button", { name: /generate/i }),
    page.getByRole("button", { name: /^create$/i })
  ];
  const button = await firstVisible(candidates);
  if (!button) throw new Error("Could not identify a visible Generate/Create button. Prompt was not submitted.");
  if (await button.isDisabled().catch(() => false)) throw new Error("Generate button is disabled.");
  await button.click();
}

async function submitAccount(account, prompt, outputDir) {
  const profileDir = path.join(PROFILE_ROOT, account.id);
  await mkdir(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: null,
    acceptDownloads: true,
    args: ["--start-maximized"]
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(account.projectUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForLoadState("domcontentloaded");
    const pageText = await page.locator("body").innerText().catch(() => "");
    if (/sign in|couldn't sign you in/i.test(pageText) && !/flow/i.test(pageText)) {
      throw new Error("Google sign-in appears required. Sign in manually in this persistent profile and rerun.");
    }
    await page.waitForTimeout(2500);
    const baselineVideos = await page.locator("video").count();
    const baselineVideoSources = await page.locator("video").evaluateAll(nodes => nodes.map(el => el.currentSrc || el.src || ""));
    await fillPrompt(page, prompt);
    await clickGenerate(page);
    await writeFile(path.join(outputDir, account.id + ".submitted.json"), JSON.stringify({
      accountId: account.id, projectUrl: account.projectUrl, submittedAt: new Date().toISOString(), baselineVideos, baselineVideoSources
    }, null, 2));
    return { account, context, page, baselineVideos, baselineVideoSources, prompt, outputDir };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function waitForNewVideo(task, timeoutMs = 30 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const videos = task.page.locator("video");
    const count = await videos.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const video = videos.nth(i);
      const info = await video.evaluate(el => ({
        src: el.currentSrc || el.src || "",
        readyState: el.readyState,
        width: el.videoWidth,
        height: el.videoHeight
      })).catch(() => null);
      const isNew = i >= task.baselineVideos || (info && info.src && !task.baselineVideoSources.includes(info.src));
      if (isNew && info && info.readyState >= 2 && info.width > 0 && info.height > 0) return video;
    }
    await sleep(5000);
  }
  throw new Error("Timed out waiting for a playable generated video. Browser left open for inspection.");
}

async function downloadOriginal(task) {
  const page = task.page;
  const menuButton = await firstVisible([
    page.getByRole("button", { name: /more|options|menu/i }),
    page.locator('button[aria-label*="More" i]'),
    page.locator('button[aria-label*="option" i]')
  ]);
  if (!menuButton) throw new Error("Generated video is visible, but its action menu could not be identified.");
  await menuButton.click();
  const downloadItem = await firstVisible([
    page.getByText(/^download$/i),
    page.getByRole("menuitem", { name: /download/i }),
    page.getByRole("button", { name: /download/i })
  ]);
  if (!downloadItem) throw new Error("Could not identify the generated video's Download menu item.");
  await downloadItem.click();
  const original = await firstVisible([
    page.getByText(/720p.*original size/i),
    page.getByText(/original size.*720p/i),
    page.getByRole("menuitem", { name: /720p.*original/i }),
    page.getByRole("button", { name: /720p.*original/i })
  ]);
  if (!original) throw new Error("Could not identify the 720p Original size export option.");
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await original.click();
  const download = await downloadPromise;
  const suggested = download.suggestedFilename() || task.account.id + ".mp4";
  const tempPath = path.join(task.outputDir, task.account.id + ".download");
  await download.saveAs(tempPath);
  const size = (await stat(tempPath)).size;
  if (size < 1024) throw new Error("Downloaded file is unexpectedly small (" + size + " bytes).");
  const ext = path.extname(suggested).toLowerCase() || ".mp4";
  const finalPath = path.join(task.outputDir, task.account.id + ext);
  await rename(tempPath, finalPath);
  return { path: finalPath, size, suggestedFilename: suggested };
}

async function main() {
  await mkdir(PROFILE_ROOT, { recursive: true });
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const accountsConfig = await loadJson("config/accounts.json").catch(() => loadJson("config/accounts.example.json"));
  const promptConfig = await loadJson("prompts.json").catch(() => loadJson("prompts.example.json"));
  if (!Array.isArray(accountsConfig.accounts) || accountsConfig.accounts.length !== 5) {
    throw new Error("config/accounts.json must contain exactly five accounts.");
  }
  if (!Array.isArray(promptConfig.prompts) || promptConfig.prompts.length !== 5) {
    throw new Error("prompts.json must contain exactly five prompts.");
  }
  for (const account of accountsConfig.accounts) {
    const url = new URL(account.projectUrl);
    if (url.hostname !== "flow.google.com") throw new Error("Invalid Flow project host for " + account.id);
    if (!account.id) throw new Error("Every account requires a stable id.");
  }
  const topic = String(promptConfig.topic || "Flow Job").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 80);
  const jobDir = path.join(OUTPUT_ROOT, topic + " - " + JOB_ID);
  const videoDir = path.join(jobDir, "videos");
  const promptDir = path.join(jobDir, "prompts");
  await mkdir(videoDir, { recursive: true });
  await mkdir(promptDir, { recursive: true });
  for (let i = 0; i < 5; i++) {
    await writeFile(path.join(promptDir, "prompt_" + String(i + 1).padStart(2, "0") + ".txt"), promptConfig.prompts[i], "utf8");
  }
  const state = { jobId: JOB_ID, topic, startedAt: new Date().toISOString(), status: "launching", accounts: [] };
  const saveState = () => writeFile(path.join(jobDir, "job.json"), JSON.stringify(state, null, 2));
  await saveState();

  console.log("Launching five persistent Chrome profiles and submitting independently in parallel.");
  const settled = await Promise.allSettled(accountsConfig.accounts.map((account, i) =>
    submitAccount(account, promptConfig.prompts[i], videoDir)
  ));
  const tasks = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      tasks.push(result.value);
      state.accounts.push({ id: accountsConfig.accounts[i].id, status: "submitted" });
      console.log(accountsConfig.accounts[i].id + ": prompt submitted.");
    } else {
      state.accounts.push({ id: accountsConfig.accounts[i].id, status: "error", error: String(result.reason?.message || result.reason) });
      console.error(accountsConfig.accounts[i].id + ": " + (result.reason?.message || result.reason));
    }
  }
  state.status = "generating";
  await saveState();

  await Promise.all(tasks.map(async task => {
    const record = state.accounts.find(x => x.id === task.account.id);
    try {
      await waitForNewVideo(task);
      record.status = "video-ready";
      await saveState();
      const result = await downloadOriginal(task);
      record.status = "downloaded";
      record.file = path.relative(jobDir, result.path);
      record.bytes = result.size;
      console.log(task.account.id + ": downloaded " + result.suggestedFilename + " (" + result.size + " bytes).");
    } catch (error) {
      record.status = "error";
      record.error = String(error?.message || error);
      const safe = task.account.id + "-failure.png";
      await task.page.screenshot({ path: path.join(ARTIFACT_ROOT, safe), fullPage: true }).catch(() => {});
      record.screenshot = path.relative(ROOT, path.join(ARTIFACT_ROOT, safe));
      console.error(task.account.id + ": " + record.error);
    } finally {
      await saveState();
      // Keep browser windows open for diagnosis; close them manually when finished.
    }
  }));
  state.status = state.accounts.every(x => x.status === "downloaded") ? "completed" : "completed-with-errors";
  state.finishedAt = new Date().toISOString();
  await saveState();
  console.log("Job folder: " + jobDir);
  console.log("Browser windows are intentionally left open.");
  if (state.status !== "completed") process.exitCode = 1;
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const projectUrl = process.env.FLOW_PROJECT_URL;

if (!projectUrl) {
  console.error("Missing FLOW_PROJECT_URL. Set it to your Google Flow project URL.");
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(projectUrl);
} catch {
  console.error("FLOW_PROJECT_URL is not a valid URL.");
  process.exit(1);
}

if (parsedUrl.hostname !== "flow.google.com") {
  console.error("For safety, FLOW_PROJECT_URL must use flow.google.com.");
  process.exit(1);
}

const root = process.cwd();
const profileDir = path.join(root, "profiles", "account-01");
const artifactsDir = path.join(root, "artifacts");
await mkdir(profileDir, { recursive: true });
await mkdir(artifactsDir, { recursive: true });

let context;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: null,
    acceptDownloads: true,
    args: ["--start-maximized"]
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(15000);

  console.log("Opening the assigned Flow project...");
  await page.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  console.log("Chrome is open. Sign in manually if Google requests it.");
  console.log("Wait until the Flow project is fully visible, then press Enter here.");

  const rl = readline.createInterface({ input, output });
  await rl.question("");
  rl.close();

  await page.screenshot({
    path: path.join(artifactsDir, "flow-inspection.png"),
    fullPage: true,
    animations: "disabled"
  });

  const visibleText = await page.locator("body").innerText({ timeout: 20000 });
  await writeFile(path.join(artifactsDir, "flow-visible-text.txt"), visibleText, "utf8");

  console.log("Inspection saved:");
  console.log("  artifacts/flow-inspection.png");
  console.log("  artifacts/flow-visible-text.txt");
  console.log("Persistent profile: profiles/account-01");
  console.log("No generation or download actions were triggered.");
} catch (error) {
  console.error("Playwright inspection failed:", error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
}

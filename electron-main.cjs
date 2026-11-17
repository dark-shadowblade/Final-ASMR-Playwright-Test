const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let win;
let child;

function send(type, message) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("runner-event", { type, message: String(message) });
  }
}

function prepare() {
  const root = app.getPath("userData");
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  const base = app.isPackaged ? path.join(process.resourcesPath, "app.asar") : __dirname;

  for (const [src, dst] of [
    ["config/accounts.example.json", "config/accounts.example.json"],
    ["prompts.example.json", "prompts.example.json"]
  ]) {
    const target = path.join(root, dst);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(base, src), target);
  }

  for (const [src, dst] of [
    ["config/accounts.example.json", "config/accounts.json"],
    ["prompts.example.json", "prompts.json"]
  ]) {
    const target = path.join(root, dst);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(root, src), target);
  }

  for (const dir of ["profiles", "output", "artifacts"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  return root;
}

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 520,
    webPreferences: {
      preload: path.join(__dirname, "electron-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "electron-ui.html"));
}

ipcMain.handle("start-runner", async () => {
  if (child) return { ok: false, message: "A run is already active." };

  const root = prepare();
  const browserPath = app.isPackaged
    ? path.join(process.resourcesPath, "playwright-browsers")
    : path.join(__dirname, ".pw-browsers");

  child = spawn(
    process.execPath,
    [path.join(__dirname, "src", "runner.js")],
    {
      cwd: root,
      windowsHide: false,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PLAYWRIGHT_BROWSERS_PATH: browserPath
      }
    }
  );

  child.stdout.on("data", data => send("log", data.toString()));
  child.stderr.on("data", data => send("error", data.toString()));
  child.on("error", error => {
    send("error", error.message);
    child = null;
  });
  child.on("close", code => {
    send("exit", "Runner finished with exit code " + code);
    child = null;
  });

  return { ok: true, message: "Started. Configure files in: " + root };
});

ipcMain.handle("open-config", async () => {
  const root = prepare();
  await shell.openPath(root);
  return root;
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

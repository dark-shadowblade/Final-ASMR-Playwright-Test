const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
let win, child;
function send(type, message) { if (win && !win.isDestroyed()) win.webContents.send("runner-event", { type, message: String(message) }); }
function prepare() {
  const root = app.getPath("userData");
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  const base = app.isPackaged ? process.resourcesPath + "/app.asar" : __dirname;
  for (const [src,dst] of [["config/accounts.example.json","config/accounts.example.json"],["prompts.example.json","prompts.example.json"]]) {
    const target=path.join(root,dst); if(!fs.existsSync(target)) fs.copyFileSync(path.join(base,src),target);
  }
  for (const [src,dst] of [["config/accounts.example.json","config/accounts.json"],["prompts.example.json","prompts.json"]]) {
    const target=path.join(root,dst); if(!fs.existsSync(target)) fs.copyFileSync(path.join(root,src),target);
  }
  for(const d of ["profiles","output","artifacts"]) fs.mkdirSync(path.join(root,d),{recursive:true});
  return root;
}
function createWindow() {
  win=new BrowserWindow({width:760,height:520,webPreferences:{preload:path.join(__dirname,"electron-preload.cjs"),contextIsolation:true,nodeIntegration:false}});
  win.loadFile(path.join(__dirname,"electron-ui.html"));
}
ipcMain.handle("start-runner", async()=>{
  if(child) return {ok:false,message:"A run is already active."};
  const root=prepare();
  child=spawn(process.execPath,[path.join(__dirname,"src","runner.js")],{cwd:root,windowsHide:false,env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}});
  child.stdout.on("data",d=>send("log",d.toString()));
  child.stderr.on("data",d=>send("error",d.toString()));
  child.on("error",e=>{send("error",e.message);child=null;});
  child.on("close",c=>{send("exit","Runner finished with exit code "+c);child=null;});
  return {ok:true,message:"Started. Configure files in: "+root};
});
ipcMain.handle("open-config",async()=>{const root=prepare();await shell.openPath(root);return root;});
app.whenReady().then(createWindow);
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});

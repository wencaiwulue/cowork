"use strict";
const electron = require("electron");
const path = require("path");
const child_process = require("child_process");
const net = require("net");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const net__namespace = /* @__PURE__ */ _interopNamespaceDefault(net);
const template = [
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" }
    ]
  },
  {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "toggleDevTools" }
    ]
  }
];
if (process.platform === "darwin") {
  template.unshift({
    label: electron.app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" }
    ]
  });
}
const menu = electron.Menu.buildFromTemplate(template);
electron.Menu.setApplicationMenu(menu);
let backendProcess = null;
let backendPort = 8e3;
async function findFreePort(startPort) {
  let port = startPort;
  while (true) {
    if (await isPortFree(port))
      return port;
    port++;
  }
}
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net__namespace.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}
function startPythonBackend(port) {
  const backendPath = path__namespace.join(process.cwd(), "backend", "main.py");
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const pythonArgs = [backendPath, "--port", port.toString()];
  console.log(`Starting backend: ${pythonCmd} ${pythonArgs.join(" ")}`);
  backendProcess = child_process.spawn(pythonCmd, pythonArgs, {
    cwd: path__namespace.join(process.cwd(), "backend"),
    stdio: "inherit"
  });
  backendProcess.on("error", (err) => {
    console.error("Failed to start backend process:", err);
  });
  process.on("exit", () => {
    if (backendProcess)
      backendProcess.kill();
  });
}
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    icon: path__namespace.join(__dirname, "../src/assets/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: "CoWork"
  });
  process.env.BACKEND_URL = `http://127.0.0.1:${backendPort}`;
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path__namespace.join(__dirname, "../dist/index.html"));
  }
}
electron.app.whenReady().then(async () => {
  backendPort = await findFreePort(51234);
  startPythonBackend(backendPort);
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});

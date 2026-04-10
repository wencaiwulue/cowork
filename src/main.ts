import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';

// Enable standard edit shortcuts (Copy, Paste, etc.)
const template: any[] = [
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'toggleDevTools' }
    ]
  }
];

if (process.platform === 'darwin') {
  template.unshift({
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  });
}

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

let backendProcess: ChildProcess | null = null;
let backendPort = 8000;

async function findFreePort(startPort: number): Promise<number> {
  let port = startPort;
  while (true) {
    if (await isPortFree(port)) return port;
    port++;
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

function startPythonBackend(port: number) {
  const backendPath = path.join(process.cwd(), 'backend', 'main.py');
  
  // Directly use system python3 or python
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const pythonArgs = [backendPath, '--port', port.toString()];

  console.log(`Starting backend: ${pythonCmd} ${pythonArgs.join(' ')}`);
  
  backendProcess = spawn(pythonCmd, pythonArgs, {
    cwd: path.join(process.cwd(), 'backend'),
    stdio: 'inherit'
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend process:', err);
  });

  process.on('exit', () => {
    if (backendProcess) backendProcess.kill();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../src/assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'CoWork',
  });

  // Inject dynamic backend URL into the window process
  process.env.BACKEND_URL = `http://127.0.0.1:${backendPort}`;

  // In development, you might be loading from Vite (localhost:5173)
  // For simplicity, we'll continue with file loading or adjust based on your vite setup
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Correctly point to the bundled HTML in dist/
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  backendPort = await findFreePort(51234);
  startPythonBackend(backendPort);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

import { app, BrowserWindow, Menu, ipcMain } from 'electron';
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

async function waitForBackend(port: number, timeout: number): Promise<boolean> {
  const startTime = Date.now();
  const checkInterval = 500; // Check every 500ms
  const backendUrl = `http://127.0.0.1:${port}`;

  while (Date.now() - startTime < timeout) {
    try {
      // Try to fetch a simple endpoint to check if backend is ready
      const response = await fetch(`${backendUrl}/agents`, { method: 'GET' });
      if (response.ok) {
        return true;
      }
    } catch {
      // Backend not ready yet, wait and retry
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }
  return false;
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

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../src/assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'CoWork',
    show: false, // Don't show until backend is ready
  });

  // Inject dynamic backend URL into the window process
  process.env.BACKEND_URL = `http://127.0.0.1:${backendPort}`;

  // In development, you might be loading from Vite (localhost:5173)
  // For simplicity, we'll continue with file loading or adjust based on your vite setup
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Correctly point to the bundled HTML in dist/
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return mainWindow;
}

app.whenReady().then(async () => {
  backendPort = await findFreePort(51234);
  startPythonBackend(backendPort);

  // Create window but don't show it yet
  const win = createWindow();

  // Wait for backend to be ready
  console.log('Waiting for backend to be ready...');
  const backendReady = await waitForBackend(backendPort, 60000);

  if (backendReady) {
    console.log('Backend is ready! Showing window and notifying frontend...');
    win?.show();

    // Notify frontend that backend is ready
    win?.webContents.send('backend-ready', { backendUrl: `http://127.0.0.1:${backendPort}` });
  } else {
    console.error('Backend failed to start within timeout. Showing window anyway...');
    win?.show();
  }

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

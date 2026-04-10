export function getBackendUrl(): string {
  // Access dynamic backend URL injected by Electron's main process
  return process.env.BACKEND_URL || 'http://127.0.0.1:51234';
}

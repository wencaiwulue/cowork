export function getBackendUrl(): string {
  // In Electron, BACKEND_URL is set by the main process.
  // In browser dev mode, fall back to localhost (resolved by Vite proxy or OS).
  return (typeof process !== 'undefined' && process.env?.BACKEND_URL)
    || 'http://localhost:51234';
}

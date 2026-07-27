export function buildElectronLaunch(electronPath, mainPath) {
  return {
    command: electronPath,
    args: [mainPath],
  }
}

export function isPrematureElectronExit(elapsedMs, graceMs) {
  return elapsedMs < graceMs
}

export function isExistingInstanceHandoff(elapsedMs, graceMs, code, signal) {
  return isPrematureElectronExit(elapsedMs, graceMs) && code === 0 && signal == null
}

export function isFailedElectronStartup(elapsedMs, graceMs, code, signal) {
  return isPrematureElectronExit(elapsedMs, graceMs) && !isExistingInstanceHandoff(elapsedMs, graceMs, code, signal)
}

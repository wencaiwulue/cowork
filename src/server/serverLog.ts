export function logServerMessage(): void {}
export function createServerLogger(): any {
  return { log: logServerMessage }
}

export function startServer(..._args: any[]): {
  port: number
  stop(force?: boolean): void
} {
  return {
    port: 0,
    stop() {},
  }
}

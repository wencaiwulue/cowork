declare namespace Bun {
  type HashInput = string | ArrayBuffer | ArrayBufferView

  interface Semver {
    order(a: string, b: string): -1 | 0 | 1
    satisfies(version: string, range: string): boolean
  }

  interface YamlApi {
    parse(input: string): unknown
  }

  interface SpawnResult {
    stdout: ReadableStream<Uint8Array> | Blob
    stderr: ReadableStream<Uint8Array> | Blob
    exited: Promise<number>
  }

  interface TcpSocket<TData = unknown> {
    data: TData
    write(data: string | Uint8Array): number
    end(): void
  }

  interface ListenOptions<TData = unknown> {
    hostname?: string
    port: number
    socket: {
      open?(socket: TcpSocket<TData>): void
      data?(socket: TcpSocket<TData>, data: Uint8Array): void
      drain?(socket: TcpSocket<TData>): void
      close?(socket: TcpSocket<TData>): void
      error?(socket: TcpSocket<TData>, error: Error): void
    }
  }

  interface Server {
    port: number
    stop(closeActiveConnections?: boolean): void
  }

  const embeddedFiles: unknown[]
  const semver: Semver
  const YAML: YamlApi

  function gc(force?: boolean): void
  function generateHeapSnapshot(format?: string, returnType?: string): ArrayBuffer
  function hash(input: HashInput, seed?: number | bigint): number | bigint
  function listen<TData = unknown>(options: ListenOptions<TData>): Server
  function spawn(command: string[], options?: Record<string, unknown>): SpawnResult
  function stringWidth(input: string): number
  function which(command: string): string | null
  function wrapAnsi(input: string, width: number, options?: Record<string, unknown>): string
}

declare const Bun: typeof Bun

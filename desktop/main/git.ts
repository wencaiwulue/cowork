import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function gitStatus(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short'], {
      cwd,
    })
    return stdout
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export async function gitDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--', '.'], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

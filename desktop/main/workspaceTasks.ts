import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { assertWorkspaceFileTarget } from './workspaceDirectory'
import type {
  ProjectScheduledTaskInfo,
  ProjectScheduledTaskInput,
} from './ipc'

type CronTaskRecord = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
}

type CronFile = { tasks?: unknown }

type CronFields = {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

const FIELD_RANGES = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
]

function cronFilePath(cwd: string): string {
  return join(cwd, '.kode', 'scheduled_tasks.json')
}

function pausedCronFilePath(cwd: string): string {
  return join(cwd, '.kode', 'scheduled_tasks.paused.json')
}

function expandField(field: string, min: number, max: number): number[] | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const step = part.match(/^\*(?:\/(\d+))?$/)
    if (step) {
      const amount = step[1] ? Number.parseInt(step[1], 10) : 1
      if (!Number.isInteger(amount) || amount < 1) return null
      for (let value = min; value <= max; value += amount) out.add(value)
      continue
    }
    const range = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
    if (range) {
      const start = Number.parseInt(range[1]!, 10)
      const end = Number.parseInt(range[2]!, 10)
      const amount = range[3] ? Number.parseInt(range[3], 10) : 1
      const effectiveMax = min === 0 && max === 6 ? 7 : max
      if (start > end || amount < 1 || start < min || end > effectiveMax) return null
      for (let value = start; value <= end; value += amount) {
        out.add(min === 0 && max === 6 && value === 7 ? 0 : value)
      }
      continue
    }
    if (/^\d+$/.test(part)) {
      let value = Number.parseInt(part, 10)
      if (min === 0 && max === 6 && value === 7) value = 0
      if (value < min || value > max) return null
      out.add(value)
      continue
    }
    return null
  }
  return out.size ? [...out].sort((a, b) => a - b) : null
}

export function parseCronExpression(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const expanded = parts.map((part, index) =>
    expandField(part, FIELD_RANGES[index]!.min, FIELD_RANGES[index]!.max),
  )
  if (expanded.some(part => !part)) return null
  return {
    minute: expanded[0]!,
    hour: expanded[1]!,
    dayOfMonth: expanded[2]!,
    month: expanded[3]!,
    dayOfWeek: expanded[4]!,
  }
}

function computeNextCronRun(fields: CronFields, from = new Date()): Date | null {
  const minuteSet = new Set(fields.minute)
  const hourSet = new Set(fields.hour)
  const domSet = new Set(fields.dayOfMonth)
  const monthSet = new Set(fields.month)
  const dowSet = new Set(fields.dayOfWeek)
  const domWild = fields.dayOfMonth.length === 31
  const dowWild = fields.dayOfWeek.length === 7
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (!monthSet.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    const dom = cursor.getDate()
    const dow = cursor.getDay()
    const dayMatches =
      domWild && dowWild
        ? true
        : domWild
          ? dowSet.has(dow)
          : dowWild
            ? domSet.has(dom)
            : domSet.has(dom) || dowSet.has(dow)
    if (!dayMatches) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!hourSet.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!minuteSet.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1)
      continue
    }
    return cursor
  }
  return null
}

export function nextCronRunAt(expression: string, fromMs: number): number | undefined {
  const fields = parseCronExpression(expression)
  const nextRun = fields ? computeNextCronRun(fields, new Date(fromMs)) : null
  return nextRun?.getTime()
}

function normalizeTask(raw: unknown): CronTaskRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const task = raw as Record<string, unknown>
  if (
    typeof task.id !== 'string' ||
    typeof task.cron !== 'string' ||
    typeof task.prompt !== 'string' ||
    typeof task.createdAt !== 'number' ||
    !parseCronExpression(task.cron)
  ) {
    return undefined
  }
  return {
    id: task.id,
    cron: task.cron,
    prompt: task.prompt,
    createdAt: task.createdAt,
    ...(typeof task.lastFiredAt === 'number' ? { lastFiredAt: task.lastFiredAt } : {}),
    ...(task.recurring ? { recurring: true } : {}),
    ...(task.permanent ? { permanent: true } : {}),
  }
}

function toInfo(task: CronTaskRecord, enabled: boolean): ProjectScheduledTaskInfo {
  return {
    ...task,
    enabled,
    nextRunAt: enabled ? nextCronRunAt(task.cron, task.lastFiredAt ?? task.createdAt) : undefined,
  }
}

async function readCronFile(cwd: string, pathForCwd = cronFilePath(cwd)): Promise<CronFile> {
  try {
    const path = await assertWorkspaceFileTarget(cwd, pathForCwd)
    return JSON.parse(await readFile(path, 'utf8')) as CronFile
  } catch (cause) {
    if (
      cause instanceof Error &&
        cause.message.startsWith('Workspace file target')
    ) {
      throw cause
    }
    return { tasks: [] }
  }
}

async function readTaskRecords(cwd: string, pathForCwd = cronFilePath(cwd)): Promise<CronTaskRecord[]> {
  const parsed = await readCronFile(cwd, pathForCwd)
  if (!Array.isArray(parsed.tasks)) return []
  return parsed.tasks.flatMap(task => {
    const normalized = normalizeTask(task)
    return normalized ? [normalized] : []
  })
}

async function writeTaskRecords(
  cwd: string,
  tasks: CronTaskRecord[],
  pathForCwd = cronFilePath(cwd),
): Promise<void> {
  await mkdir(join(cwd, '.kode'), { recursive: true })
  const path = await assertWorkspaceFileTarget(cwd, pathForCwd, { forWrite: true })
  await writeFile(path, `${JSON.stringify({ tasks }, null, 2)}\n`, 'utf8')
}

export async function listProjectScheduledTasks(
  cwd: string,
): Promise<ProjectScheduledTaskInfo[]> {
  const [active, paused] = await Promise.all([
    readTaskRecords(cwd),
    readTaskRecords(cwd, pausedCronFilePath(cwd)),
  ])
  const activeIds = new Set(active.map(task => task.id))
  return [
    ...active.map(task => toInfo(task, true)),
    ...paused
      .filter(task => !activeIds.has(task.id))
      .map(task => toInfo(task, false)),
  ]
}

export async function addOrUpdateProjectScheduledTask(
  cwd: string,
  input: ProjectScheduledTaskInput,
): Promise<ProjectScheduledTaskInfo[]> {
  const tasks = await readTaskRecords(cwd)
  const pausedTasks = await readTaskRecords(cwd, pausedCronFilePath(cwd))
  const taskId = input.id?.trim()
  const index = taskId ? tasks.findIndex(task => task.id === taskId) : -1
  const pausedIndex = taskId ? pausedTasks.findIndex(task => task.id === taskId) : -1
  if (taskId && index < 0 && pausedIndex < 0) {
    throw new Error(`Project scheduled task not found: ${taskId}`)
  }
  const existing = index >= 0 ? tasks[index] : pausedIndex >= 0 ? pausedTasks[pausedIndex] : undefined
  const next: CronTaskRecord = {
    id: existing?.id ?? taskId ?? randomUUID().slice(0, 8),
    cron: input.cron.trim(),
    prompt: input.prompt.trim(),
    createdAt: existing?.createdAt ?? Date.now(),
    ...(existing?.lastFiredAt ? { lastFiredAt: existing.lastFiredAt } : {}),
    ...(input.recurring ? { recurring: true } : {}),
    ...(existing?.permanent ? { permanent: true } : {}),
  }
  if (index >= 0) tasks[index] = next
  else tasks.push(next)
  if (pausedIndex >= 0) {
    pausedTasks.splice(pausedIndex, 1)
    await writeTaskRecords(cwd, pausedTasks, pausedCronFilePath(cwd))
  }
  await writeTaskRecords(cwd, tasks)
  return listProjectScheduledTasks(cwd)
}

export async function removeProjectScheduledTask(
  cwd: string,
  taskId: string,
): Promise<ProjectScheduledTaskInfo[]> {
  const currentTasks = await readTaskRecords(cwd)
  const currentPausedTasks = await readTaskRecords(cwd, pausedCronFilePath(cwd))
  const tasks = currentTasks.filter(task => task.id !== taskId)
  const pausedTasks = currentPausedTasks.filter(task => task.id !== taskId)
  if (tasks.length === currentTasks.length && pausedTasks.length === currentPausedTasks.length) {
    throw new Error(`Project scheduled task not found: ${taskId}`)
  }
  await writeTaskRecords(cwd, tasks)
  await writeTaskRecords(cwd, pausedTasks, pausedCronFilePath(cwd))
  return listProjectScheduledTasks(cwd)
}

export async function pauseProjectScheduledTask(
  cwd: string,
  taskId: string,
): Promise<ProjectScheduledTaskInfo[]> {
  const activeTasks = await readTaskRecords(cwd)
  const index = activeTasks.findIndex(task => task.id === taskId)
  if (index < 0) {
    throw new Error(`Project scheduled task not found: ${taskId}`)
  }
  const [task] = activeTasks.splice(index, 1)
  if (!task) {
    throw new Error(`Project scheduled task not found: ${taskId}`)
  }
  const pausedTasks = (await readTaskRecords(cwd, pausedCronFilePath(cwd)))
    .filter(item => item.id !== taskId)
  pausedTasks.push(task)
  await writeTaskRecords(cwd, activeTasks)
  await writeTaskRecords(cwd, pausedTasks, pausedCronFilePath(cwd))
  return listProjectScheduledTasks(cwd)
}

export async function resumeProjectScheduledTask(
  cwd: string,
  taskId: string,
): Promise<ProjectScheduledTaskInfo[]> {
  const pausedTasks = await readTaskRecords(cwd, pausedCronFilePath(cwd))
  const index = pausedTasks.findIndex(task => task.id === taskId)
  if (index < 0) {
    throw new Error(`Project scheduled task not found: ${taskId}`)
  }
  const [task] = pausedTasks.splice(index, 1)
  if (!task) {
    throw new Error(`Project scheduled task not found: ${taskId}`)
  }
  const activeTasks = (await readTaskRecords(cwd)).filter(item => item.id !== taskId)
  activeTasks.push(task)
  await writeTaskRecords(cwd, activeTasks)
  await writeTaskRecords(cwd, pausedTasks, pausedCronFilePath(cwd))
  return listProjectScheduledTasks(cwd)
}

export async function fireDueProjectScheduledTasks(
  cwd: string,
  now = Date.now(),
): Promise<ProjectScheduledTaskInfo[]> {
  const tasks = await readTaskRecords(cwd)
  const fired: CronTaskRecord[] = []
  const remaining: CronTaskRecord[] = []

  for (const task of tasks) {
    const nextRunAt = nextCronRunAt(task.cron, task.lastFiredAt ?? task.createdAt)
    if (!nextRunAt || nextRunAt > now) {
      remaining.push(task)
      continue
    }

    fired.push(task)
    if (task.recurring || task.permanent) {
      remaining.push({
        ...task,
        lastFiredAt: now,
      })
    }
  }

  if (fired.length > 0) {
    await writeTaskRecords(cwd, remaining)
  }

  return fired.map(task => ({
    ...task,
    enabled: true,
    nextRunAt: now,
  }))
}

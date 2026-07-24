import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  addOrUpdateProjectScheduledTask,
  fireDueProjectScheduledTasks,
  listProjectScheduledTasks,
  pauseProjectScheduledTask,
  parseCronExpression,
  removeProjectScheduledTask,
  resumeProjectScheduledTask,
} from '../main/workspaceTasks'

async function tempWorkspace(): Promise<string> {
  const root = join(tmpdir(), `claude-desktop-tasks-${randomUUID()}`)
  await mkdir(join(root, '.claude'), { recursive: true })
  return root
}

describe('project scheduled tasks', () => {
  it('parses supported 5-field cron expressions', () => {
    expect(parseCronExpression('*/5 9-17 * * 1-5')).not.toBeNull()
    expect(parseCronExpression('bad cron')).toBeNull()
    expect(parseCronExpression('60 * * * *')).toBeNull()
  })

  it('adds, updates, lists, and removes native Claude Code cron tasks', async () => {
    const root = await tempWorkspace()

    let tasks = await addOrUpdateProjectScheduledTask(root, {
      cron: '0 9 * * *',
      prompt: 'run daily check',
      recurring: true,
    })
    expect(tasks).toMatchObject([{
      cron: '0 9 * * *',
      prompt: 'run daily check',
      recurring: true,
    }])
    expect(tasks[0]?.id).toHaveLength(8)
    expect(tasks[0]?.nextRunAt).toEqual(expect.any(Number))

    tasks = await addOrUpdateProjectScheduledTask(root, {
      id: tasks[0]!.id,
      cron: '30 10 * * 1',
      prompt: 'updated prompt',
      recurring: false,
    })
    expect(tasks).toMatchObject([{
      cron: '30 10 * * 1',
      prompt: 'updated prompt',
    }])
    expect(tasks[0]?.recurring).toBeUndefined()

    const raw = JSON.parse(await readFile(join(root, '.claude/scheduled_tasks.json'), 'utf8'))
    expect(raw.tasks[0]).toMatchObject({
      id: tasks[0]!.id,
      cron: '30 10 * * 1',
      prompt: 'updated prompt',
      createdAt: expect.any(Number),
    })
    expect(raw.tasks[0].enabled).toBeUndefined()

    expect(await listProjectScheduledTasks(root)).toHaveLength(1)
    expect(await removeProjectScheduledTask(root, tasks[0]!.id)).toEqual([])
  })

  it('rejects removing a missing project scheduled task', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, '.claude/scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'existing-task',
        cron: '0 9 * * *',
        prompt: 'run daily',
        createdAt: Date.now(),
      }],
    }))

    await expect(removeProjectScheduledTask(root, 'missing-task')).rejects.toThrow(
      'Project scheduled task not found: missing-task',
    )
  })

  it('rejects updating a missing project scheduled task id', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, '.claude/scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'existing-task',
        cron: '0 9 * * *',
        prompt: 'run daily',
        createdAt: Date.now(),
      }],
    }))

    await expect(addOrUpdateProjectScheduledTask(root, {
      id: 'missing-task',
      cron: '30 10 * * 1',
      prompt: 'updated prompt',
    })).rejects.toThrow('Project scheduled task not found: missing-task')
    const raw = JSON.parse(await readFile(join(root, '.claude/scheduled_tasks.json'), 'utf8'))
    expect(raw.tasks).toHaveLength(1)
    expect(raw.tasks[0].id).toBe('existing-task')
  })

  it('pauses and resumes project scheduled tasks without changing the native active schema', async () => {
    const root = await tempWorkspace()
    const createdAt = new Date(2026, 0, 1, 0, 0).getTime()
    await writeFile(join(root, '.claude/scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'recurring',
        cron: '1 0 * * *',
        prompt: 'run daily',
        createdAt,
        recurring: true,
      }],
    }))

    let tasks = await pauseProjectScheduledTask(root, 'recurring')
    expect(tasks).toMatchObject([{
      id: 'recurring',
      enabled: false,
      nextRunAt: undefined,
    }])
    expect(JSON.parse(await readFile(join(root, '.claude/scheduled_tasks.json'), 'utf8')).tasks).toEqual([])
    const pausedRaw = JSON.parse(await readFile(join(root, '.claude/scheduled_tasks.paused.json'), 'utf8'))
    expect(pausedRaw.tasks[0]).toMatchObject({
      id: 'recurring',
      cron: '1 0 * * *',
      prompt: 'run daily',
      createdAt,
      recurring: true,
    })
    expect(pausedRaw.tasks[0].enabled).toBeUndefined()

    expect(await fireDueProjectScheduledTasks(root, new Date(2026, 0, 1, 0, 1).getTime())).toEqual([])
    tasks = await resumeProjectScheduledTask(root, 'recurring')
    expect(tasks).toMatchObject([{
      id: 'recurring',
      enabled: true,
      nextRunAt: new Date(2026, 0, 1, 0, 1).getTime(),
    }])
    expect(JSON.parse(await readFile(join(root, '.claude/scheduled_tasks.paused.json'), 'utf8')).tasks).toEqual([])
    expect(JSON.parse(await readFile(join(root, '.claude/scheduled_tasks.json'), 'utf8')).tasks[0].enabled).toBeUndefined()
  })

  it('rejects pausing and resuming missing project scheduled tasks', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, '.claude/scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'active-task',
        cron: '0 9 * * *',
        prompt: 'run daily',
        createdAt: Date.now(),
      }],
    }))
    await writeFile(join(root, '.claude/scheduled_tasks.paused.json'), JSON.stringify({
      tasks: [{
        id: 'paused-task',
        cron: '0 10 * * *',
        prompt: 'run weekly',
        createdAt: Date.now(),
      }],
    }))

    await expect(pauseProjectScheduledTask(root, 'missing-task')).rejects.toThrow(
      'Project scheduled task not found: missing-task',
    )
    await expect(resumeProjectScheduledTask(root, 'missing-task')).rejects.toThrow(
      'Project scheduled task not found: missing-task',
    )
  })

  it('ignores malformed tasks already present on disk', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, '.claude/scheduled_tasks.json'), JSON.stringify({
      tasks: [
        { id: 'ok-task', cron: '0 9 * * *', prompt: 'ok', createdAt: Date.now() },
        { id: 'bad-task', cron: 'bad', prompt: 'bad', createdAt: Date.now() },
      ],
    }))

    expect(await listProjectScheduledTasks(root)).toMatchObject([{ id: 'ok-task' }])
  })

  it('rejects project task files that are symlinks outside the workspace', async () => {
    const root = await tempWorkspace()
    const outside = join(tmpdir(), `claude-desktop-tasks-outside-${randomUUID()}`)
    await mkdir(outside, { recursive: true })
    const outsideTasks = join(outside, 'scheduled_tasks.json')
    await writeFile(outsideTasks, JSON.stringify({
      tasks: [{
        id: 'outside-task',
        cron: '0 9 * * *',
        prompt: 'outside',
        createdAt: Date.now(),
      }],
    }))
    await symlink(outsideTasks, join(root, '.claude', 'scheduled_tasks.json'))

    await expect(listProjectScheduledTasks(root)).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(addOrUpdateProjectScheduledTask(root, {
      cron: '0 10 * * *',
      prompt: 'new task',
    })).rejects.toThrow('Workspace file target must not be a symlink:')
    await expect(removeProjectScheduledTask(root, 'outside-task')).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(pauseProjectScheduledTask(root, 'outside-task')).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )

    expect(await readFile(outsideTasks, 'utf8')).toContain('outside-task')
  })

  it('rejects paused project task sidecars that are symlinks outside the workspace', async () => {
    const root = await tempWorkspace()
    const outside = join(tmpdir(), `claude-desktop-paused-tasks-outside-${randomUUID()}`)
    await mkdir(outside, { recursive: true })
    const outsideTasks = join(outside, 'scheduled_tasks.paused.json')
    await writeFile(outsideTasks, JSON.stringify({
      tasks: [{
        id: 'paused-outside-task',
        cron: '0 9 * * *',
        prompt: 'outside',
        createdAt: Date.now(),
      }],
    }))
    await symlink(outsideTasks, join(root, '.claude', 'scheduled_tasks.paused.json'))

    await expect(listProjectScheduledTasks(root)).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(resumeProjectScheduledTask(root, 'paused-outside-task')).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
  })

  it('computes next run from createdAt before the first fire', async () => {
    const root = await tempWorkspace()
    const createdAt = new Date(2026, 0, 1, 0, 0).getTime()
    await writeFile(join(root, '.claude/scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'future-from-created',
        cron: '1 0 * * *',
        prompt: 'run from created anchor',
        createdAt,
      }],
    }))

    expect(await listProjectScheduledTasks(root)).toMatchObject([{
      id: 'future-from-created',
      nextRunAt: new Date(2026, 0, 1, 0, 1).getTime(),
    }])
  })

  it('fires due one-shot tasks once and removes them from disk', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, '.claude/scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'one-shot',
        cron: '1 0 * * *',
        prompt: 'run once',
        createdAt: new Date(2026, 0, 1, 0, 0).getTime(),
      }],
    }))

    const fired = await fireDueProjectScheduledTasks(
      root,
      new Date(2026, 0, 1, 0, 1).getTime(),
    )

    expect(fired).toMatchObject([{ id: 'one-shot', prompt: 'run once' }])
    expect(await listProjectScheduledTasks(root)).toEqual([])
  })

  it('fires due recurring tasks and persists lastFiredAt', async () => {
    const root = await tempWorkspace()
    const firedAt = new Date(2026, 0, 1, 0, 1).getTime()
    await writeFile(join(root, '.claude/scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'recurring',
        cron: '1 0 * * *',
        prompt: 'run daily',
        createdAt: new Date(2026, 0, 1, 0, 0).getTime(),
        recurring: true,
      }],
    }))

    const fired = await fireDueProjectScheduledTasks(root, firedAt)
    const tasks = await listProjectScheduledTasks(root)

    expect(fired).toMatchObject([{ id: 'recurring', prompt: 'run daily' }])
    expect(tasks).toMatchObject([{
      id: 'recurring',
      prompt: 'run daily',
      recurring: true,
      lastFiredAt: firedAt,
    }])
  })
})

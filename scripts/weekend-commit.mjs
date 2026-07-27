#!/usr/bin/env node
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const REPO_ROOT = path.resolve(process.cwd())
const STATE_FILE = path.join(REPO_ROOT, '.commit-state.json')

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT }).trim()
}

function log(msg) {
  console.log(`[weekend-commit] ${msg}`)
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  }
  return { lastCommitTimestamp: null, commitCount: 0 }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function isWeekend(date) {
  const dow = date.getDay()
  return dow === 0 || dow === 6
}

function getNextCommitTimestamp(afterTimestamp) {
  // Start: at least 1 hour after previous, or today if first commit
  let date = afterTimestamp ? new Date(afterTimestamp + 2 * 3600 * 1000) : new Date()
  
  if (!afterTimestamp) {
    // First commit: find the most recent weekend day
    while (!isWeekend(date)) {
      date.setDate(date.getDate() - 1)
    }
    date.setHours(10, Math.floor(Math.random() * 60), 0, 0)
    return date
  }
  
  // After previous: ensure strictly increasing, land on weekend
  while (!isWeekend(date) || date.getTime() <= afterTimestamp) {
    if (!isWeekend(date)) {
      // Move to next Saturday
      const daysUntilSat = (6 - date.getDay() + 7) % 7
      date.setDate(date.getDate() + (daysUntilSat === 0 ? 7 : daysUntilSat))
      date.setHours(9, 0, 0, 0)
    } else {
      // On weekend but need later time or day
      if (date.getHours() >= 20) {
        // Past 8pm, move to next weekend day
        date.setDate(date.getDate() + 1)
        date.setHours(10, Math.floor(Math.random() * 60), 0, 0)
      } else {
        date.setHours(date.getHours() + 1 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0, 0)
      }
    }
  }
  
  return date
}

function main() {
  const message = process.argv.slice(2).join(' ') || 'update'
  const state = loadState()
  const changes = run('git status --porcelain').split('\n').filter(Boolean)
  
  if (changes.length === 0) {
    log('No changes to commit.')
    return
  }

  log(`Found ${changes.length} changed files`)
  const commitDate = getNextCommitTimestamp(state.lastCommitTimestamp)
  const commitDateStr = commitDate.toISOString()
  log(`Commit date: ${commitDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)

  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: commitDateStr,
    GIT_COMMITTER_DATE: commitDateStr
  }

  execSync('git add -A', { cwd: REPO_ROOT })
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: REPO_ROOT, env, stdio: 'inherit' })
  log('Pushing...')
  execSync('git push origin master', { cwd: REPO_ROOT, stdio: 'inherit' })

  state.lastCommitTimestamp = commitDate.getTime()
  state.commitCount += 1
  saveState(state)
  log(`Done! Total weekend commits: ${state.commitCount}`)
}

main()

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

function getNextWeekendDate(afterTimestamp) {
  let date = afterTimestamp ? new Date(afterTimestamp + 3600000) : new Date()
  if (!afterTimestamp) {
    const day = date.getDay()
    if (day >= 1 && day <= 5) {
      date.setDate(date.getDate() - (day === 0 ? 6 : day + 1))
    }
  }
  while (true) {
    const dow = date.getDay()
    if (dow === 0 || dow === 6) {
      date.setHours(10 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0)
      return date
    }
    date.setDate(date.getDate() + 1)
  }
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
  const commitDate = getNextWeekendDate(state.lastCommitTimestamp)
  log(`Commit date: ${commitDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)

  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: commitDate.toISOString(),
    GIT_COMMITTER_DATE: commitDate.toISOString()
  }

  execSync('git add -A', { cwd: REPO_ROOT })
  execSync(`git commit -m "${message}" -m "Weekend commit: ${commitDate.toLocaleDateString('zh-CN')}"`, { 
    cwd: REPO_ROOT, env, stdio: 'inherit' 
  })
  log('Pushing...')
  execSync('git push origin master', { cwd: REPO_ROOT, stdio: 'inherit' })

  state.lastCommitTimestamp = commitDate.getTime()
  state.commitCount += 1
  saveState(state)
  log(`Done! Total commits: ${state.commitCount}`)
}

main()

#!/usr/bin/env node
// Stratum — start the workbench and open it fullscreen (kiosk).
//
// Forked from Faraday's: waits for the server to answer before opening the
// browser, uses a dedicated browser profile (so --kiosk is honoured and the
// operator's own profile is untouched), and takes the whole process tree down
// when either half exits. Alt+F4 closes the window; Ctrl+C stops everything.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { childEnv, kioskProfileDir, PRODUCT, repoRoot, WEB_PORT } from './stratum-config.mjs'

const BROWSERS = [
  ['Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
  ['Google Chrome', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  ['Google Chrome', join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe')],
  ['Microsoft Edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
  ['Microsoft Edge', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'],
]

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = portIndex === -1 ? String(WEB_PORT) : args[portIndex + 1]
const url = `http://127.0.0.1:${port}/`
const passthrough = args.filter((_, index) => portIndex === -1 || (index !== portIndex && index !== portIndex + 1))

const say = (message) => console.log(message)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

say(`\n  Starting ${PRODUCT}. It opens fullscreen when ready (Alt+F4 closes, Ctrl+C stops).\n`)
const server = spawn(process.execPath, [join(repoRoot, 'scripts', 'start.mjs'), '--no-open', '--port', port, ...passthrough], {
  stdio: 'inherit',
  env: childEnv,
})

let browser = null
let shuttingDown = false

function killTree(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
  try {
    child.kill()
  } catch {
    /* already gone */
  }
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  killTree(browser)
  killTree(server)
  process.exit(code ?? 0)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
server.on('exit', (code) => shutdown(code ?? 0))

async function waitForWorkbench(deadlineMs = 180_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return true
    } catch {
      /* not up yet */
    }
    if (server.exitCode !== null) return false
    await sleep(400)
  }
  return false
}

if (!(await waitForWorkbench())) {
  console.error('\n  The workbench did not start; the messages above say why.\n')
  shutdown(1)
}

const found = BROWSERS.find(([, path]) => existsSync(path))
if (!found) {
  say(`\n  No Chrome or Edge found. Open ${url} in any browser and press F11.\n`)
} else {
  const [name, path] = found
  say(`\n  Opening ${PRODUCT} fullscreen in ${name}.\n`)
  browser = spawn(
    path,
    [
      '--kiosk',
      `--user-data-dir=${kioskProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,AutofillServerCommunication',
      '--disable-background-networking',
      url,
    ],
    { stdio: 'ignore', detached: false },
  )
  browser.on('exit', () => {
    if (!shuttingDown) shutdown(0)
  })
  browser.on('error', (error) => {
    say(`\n  Could not open ${name} (${error.message}). Open ${url} yourself.\n`)
    browser = null
  })
}

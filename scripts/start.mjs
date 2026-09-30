#!/usr/bin/env node
// Stratum — bring the workbench up from a clean clone.
//
// `npm start` installs the pinned harness if missing, links this checkout's
// plugin into Stratum's own harness home (~/.dsh-stratum, never Faraday's
// ~/.dsh), writes the profile patch layers, preset and settings from
// `profile/`, and starts the web profile on :3090. Idempotent: run it again
// after editing `profile/` and the harness home catches up.
//
// Forked from Faraday's start script; Node builtins only.

import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  childEnv,
  dshHome,
  GENUI_PACKAGE,
  GENUI_VERSION,
  HARNESS_VERSION,
  PLUGIN_DIR,
  PLUGIN_PACKAGE,
  PRODUCT,
  repoRoot,
  WEB_PORT,
  workspaceDir,
} from './stratum-config.mjs'

const MIN_NODE = '22.15.0'
const MIN_PNPM = '10.11.0'
const PROFILES = ['web', 'headless']
const PRESETS = ['stratum']

const args = process.argv.slice(2)
const setupOnly = args.includes('--setup-only')
const forwarded = args.filter((argument) => argument !== '--setup-only')
if (!forwarded.includes('--port')) forwarded.push('--port', String(WEB_PORT))

const say = (message) => console.log(message)
const step = (message) => console.log(`\n==> ${message}`)

function portIsBusy(candidate) {
  return new Promise((done) => {
    const probe = createServer()
    probe.once('error', (error) => done(error.code === 'EADDRINUSE'))
    probe.once('listening', () => probe.close(() => done(false)))
    probe.listen(Number(candidate), '127.0.0.1')
  })
}

function fail(message) {
  console.error(`\n${PRODUCT} setup stopped: ${message}\n`)
  process.exit(1)
}

function capture(command) {
  const result = spawnSync(command, { shell: true, encoding: 'utf8', env: childEnv })
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() }
}

function run(command, description) {
  const result = spawnSync(command, { shell: true, stdio: 'inherit', env: childEnv })
  if (result.status !== 0) fail(`${description} failed (exit ${result.status}).\n  ${command}`)
}

function versionAtLeast(actual, minimum) {
  const parse = (value) => (value.match(/\d+/g) || []).map(Number)
  const a = parse(actual)
  const b = parse(minimum)
  for (let i = 0; i < b.length; i += 1) {
    const left = a[i] ?? 0
    if (left > b[i]) return true
    if (left < b[i]) return false
  }
  return true
}

function requireTool(command, name, minimum, install) {
  const { status, stdout } = capture(command)
  if (status !== 0 || !stdout) fail(`${name} was not found on PATH. ${install}`)
  const version = stdout.split('\n')[0].replace(/^v/, '').trim()
  if (!versionAtLeast(version, minimum)) fail(`${name} ${version} is older than the required ${minimum}. ${install}`)
  say(`  ${name} ${version} (needs >= ${minimum})`)
}

/** Merge `profile/settings.yaml` into the home's settings.yaml, keeping keys we don't own. */
function mergeSettings(fragmentPath, targetPath) {
  const fragment = parseBlocks(readFileSync(fragmentPath, 'utf8'))
  if (!existsSync(targetPath)) {
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, readFileSync(fragmentPath, 'utf8'), 'utf8')
    say('  wrote a new settings.yaml from the tracked fragment')
    return
  }
  const target = parseBlocks(readFileSync(targetPath, 'utf8'))
  const changes = []
  for (const block of fragment) {
    const existing = target.find((candidate) => candidate.key === block.key)
    if (!existing) {
      target.push(block)
      changes.push(`${block.key} (added)`)
      continue
    }
    for (const entry of block.entries) {
      const index = existing.body.findIndex((line) => line.trimStart().startsWith(`${entry.key}:`))
      if (index === -1) {
        existing.body.push(entry.line)
        changes.push(`${block.key}.${entry.key} (added)`)
      } else if (existing.body[index].trim() !== entry.line.trim()) {
        existing.body[index] = entry.line
        changes.push(`${block.key}.${entry.key} (updated)`)
      }
    }
  }
  if (changes.length === 0) {
    say('  settings.yaml already carries every key this project owns')
    return
  }
  const rendered = target.map((block) => [...block.comments, block.line, ...block.body].join('\n')).join('\n\n')
  const tail = target.trailingComments.length > 0 ? `\n\n${target.trailingComments.join('\n')}` : ''
  writeFileSync(targetPath, `${`${rendered}${tail}`.replace(/\n+$/, '')}\n`, 'utf8')
  say(`  merged: ${changes.join(', ')}`)
}

function parseBlocks(text) {
  const blocks = []
  let comments = []
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (line === '') continue
    if (line.startsWith('#')) {
      comments.push(line)
      continue
    }
    if (line.trimStart().startsWith('#') && current) {
      current.body.push(line)
      continue
    }
    if (!line.startsWith(' ')) {
      current = { key: line.split(':')[0].trim(), line, comments, body: [], entries: [] }
      blocks.push(current)
      comments = []
      continue
    }
    if (!current) continue
    current.body.push(line)
    const key = line.trim().split(':')[0]
    if (key) current.entries.push({ key, line })
  }
  blocks.trailingComments = comments
  return blocks
}

/** A fresh home gets one workspace, in Stratum's own folder, so the composer can start a session. */
function seedWorkspace() {
  mkdirSync(join(workspaceDir, 'deliverables'), { recursive: true })
  const readme = join(workspaceDir, 'README.md')
  if (!existsSync(readme)) {
    writeFileSync(readme, `# Stratum workspace

Generated replies and reports are written to \`deliverables/\`.
`, 'utf8')
  }
  const target = join(dshHome, 'storages', 'workspace.json')
  if (existsSync(target)) {
    // An earlier setup pointed the workspace at the checkout; move it.
    const registry = JSON.parse(readFileSync(target, 'utf8'))
    const workspaces = registry.tables?.workspaces ?? {}
    const mine = Object.values(workspaces).find((entry) => entry.title === PRODUCT)
    if (mine && mine.path !== realpathSync(workspaceDir)) {
      mine.path = realpathSync(workspaceDir)
      writeFileSync(target, `${JSON.stringify(registry, null, 2)}
`, 'utf8')
      say(`  moved the "${PRODUCT}" workspace to ${mine.path}`)
    } else {
      say('  a workspace registry already exists here — left as it is')
    }
    return
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  const registry = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [id], archivedSessionIds: [] },
    tables: {
      workspaces: {
        [id]: { path: realpathSync(workspaceDir), title: PRODUCT, sessionIds: [], createdAt: now, updatedAt: now },
      },
    },
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(registry, null, 2)}
`, 'utf8')
  say(`  one workspace, "${PRODUCT}", at ${registry.tables.workspaces[id].path}`)
}

step('Checking prerequisites')
requireTool('node -v', 'Node', MIN_NODE, 'Install Node 22.15.0 or newer from https://nodejs.org.')
requireTool('pnpm -v', 'pnpm', MIN_PNPM, 'Install it with `npm install -g pnpm`.')
say(`  repository: ${repoRoot}`)
say(`  harness home: ${dshHome}`)

step(`Checking the harness (@deepseek-ai/dsh@${HARNESS_VERSION})`)
const installed = capture('dsh --version')
if (installed.status === 0 && installed.stdout.split('\n')[0].trim() === HARNESS_VERSION) {
  say('  already installed at the pinned version')
} else {
  run(`npm install -g @deepseek-ai/dsh@${HARNESS_VERSION}`, 'Installing the harness')
}

/**
 * The path handed to `dsh plugin add link:…`. pnpm splits a `link:` spec at whitespace, so a checkout under
 * a path like "…\SIH Part 3\…" cannot be linked directly; link through a space-free junction instead.
 * Node resolves the plugin from its real path either way, so nothing else changes.
 */
function pluginLinkPath() {
  const real = join(repoRoot, 'plugins', PLUGIN_DIR)
  if (!/\s/.test(real)) return real
  const junction = join(homedir(), '.stratum', 'plugin-link')
  mkdirSync(dirname(junction), { recursive: true })
  if (existsSync(junction)) {
    if (realpathSync(junction) === realpathSync(real)) return junction
    unlinkSync(junction)
  }
  symlinkSync(real, junction, 'junction')
  say(`  the checkout path contains a space; linking through ${junction}`)
  return junction
}

const linkTarget = `link:${pluginLinkPath().replace(/\\/g, '/')}`
for (const profile of PROFILES) {
  step(`Linking the ${PRODUCT} plugin into the ${profile} profile`)
  const manifestPath = join(dshHome, 'profiles', profile, 'package.json')
  const current = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')).dependencies?.[PLUGIN_PACKAGE]
    : undefined
  if (current === linkTarget) say('  already points at this checkout')
  else run(`dsh plugin --profile ${profile} add "${linkTarget}"`, `Linking the plugin into the ${profile} profile`)
}

step(`Installing ${GENUI_PACKAGE}@${GENUI_VERSION} into the web profile`)
{
  const manifestPath = join(dshHome, 'profiles', 'web', 'package.json')
  const current = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')).dependencies?.[GENUI_PACKAGE]
    : undefined
  if (current === GENUI_VERSION) say('  already at the pinned version')
  else run(`dsh plugin --profile web add ${GENUI_PACKAGE}@${GENUI_VERSION}`, 'Installing the adopted plugin')
}

step('Writing the profile patch layers')
for (const profile of PROFILES) {
  const destination = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(join(repoRoot, 'profile', profile, 'cordis.patch.yml'), destination)
  say(`  ${profile}: ${destination}`)
}

step('Writing the agent preset')
for (const preset of PRESETS) {
  cpSync(join(repoRoot, 'profile', 'agent-presets', preset), join(dshHome, '.agent-presets', preset), {
    recursive: true,
    force: true,
  })
  say(`  ${preset}`)
}

step('Merging settings')
mergeSettings(join(repoRoot, 'profile', 'settings.yaml'), join(dshHome, 'settings.yaml'))

step('Seeding the workspace registry')
seedWorkspace()

if (setupOnly) {
  step('Setup complete — start the workbench with `npm start` or run.bat')
  process.exit(0)
}

step(`Starting ${PRODUCT}`)
const port = forwarded[forwarded.indexOf('--port') + 1]
if (await portIsBusy(port)) {
  fail(`something is already listening on 127.0.0.1:${port} — probably ${PRODUCT} itself. Open http://127.0.0.1:${port}.`)
}
say(`  serving http://127.0.0.1:${port}. Stop with Ctrl+C.`)
const web = spawnSync(['dsh web', ...forwarded].join(' '), { shell: true, stdio: 'inherit', env: childEnv })
process.exit(web.status ?? 0)

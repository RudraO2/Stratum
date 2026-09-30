#!/usr/bin/env node
// Stratum — is this install actually working?
//
// `npm run doctor`. Written for the person who just cloned this and wants to
// know whether it is set up correctly before trusting anything it shows them.
//
// Every check states what it looked at and what it found. A failure says what
// to run next in plain words rather than printing a stack trace. Checks are
// grouped so a missing optional piece (the GPU runtime) never reads as a broken
// install.
//
// It deliberately does NOT start anything or take over the terminal — run it
// before `run.bat`, or in another window while that one is serving.
//
// Node builtins only, by policy.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  BACKEND_PORT,
  dshHome,
  GENUI_PACKAGE,
  GENUI_VERSION,
  HARNESS_VERSION,
  LLM_PORT,
  PLUGIN_DIR,
  PLUGIN_PACKAGE,
  repoRoot,
  WEB_PORT,
  workspaceDir,
} from './stratum-config.mjs'

const MIN_NODE = '22.15.0'
const PROFILES = ['web', 'headless']
const VENV_PYTHON = 'D:\\stratum\\venv\\Scripts\\python.exe'

const args = process.argv.slice(2)
const portFlag = args.indexOf('--port')
const port = portFlag === -1 ? String(WEB_PORT) : args[portFlag + 1]

/** @type {{ level: 'ok' | 'warn' | 'fail', section: string, message: string, fix?: string }[]} */
const results = []
let section = ''

const heading = (title) => {
  section = title
  console.log(`\n${title}`)
}
const ok = (message) => {
  results.push({ level: 'ok', section, message })
  console.log(`  [ ok ] ${message}`)
}
const warn = (message, fix) => {
  results.push({ level: 'warn', section, message, fix })
  console.log(`  [note] ${message}`)
  if (fix) console.log(`         ${fix}`)
}
const bad = (message, fix) => {
  results.push({ level: 'fail', section, message, fix })
  console.log(`  [FAIL] ${message}`)
  if (fix) console.log(`         ${fix}`)
}

function capture(command, args_ = []) {
  const result = spawnSync(command, args_, { shell: args_.length === 0, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() }
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

async function getJson(url, timeout = 3000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

console.log('Stratum — checking this install')
console.log(`  repository   ${repoRoot}`)
console.log(`  harness home ${dshHome}${process.env.DSH_HOME ? ' (from DSH_HOME)' : ''}`)
console.log(`  workspace    ${workspaceDir}`)

// ── the toolchain ───────────────────────────────────────────────────────────

heading('Toolchain')

const node = capture('node -v')
if (node.status === 0 && versionAtLeast(node.stdout.replace(/^v/, ''), MIN_NODE)) ok(`Node ${node.stdout.replace(/^v/, '')}`)
else bad(`Node ${node.stdout || 'not found'} — needs ${MIN_NODE} or newer`, 'Install from https://nodejs.org and re-open this terminal.')

const pnpm = capture('pnpm -v')
if (pnpm.status === 0) ok(`pnpm ${pnpm.stdout}`)
else bad('pnpm is not on PATH', 'Run `npm install -g pnpm`. The harness shells out to it to install plugins.')

const uv = capture('uv --version')
if (uv.status === 0) ok(uv.stdout.split('\n')[0])
else warn('uv is not on PATH', 'Needed to start the backend from a clean clone: `pip install uv`.')

const dsh = capture('dsh --version')
const dshVersion = dsh.status === 0 ? dsh.stdout.split('\n')[0].trim() : null
if (dshVersion === HARNESS_VERSION) ok(`DeepSeek Harness ${dshVersion} (the pinned version)`)
else if (dshVersion) warn(`DeepSeek Harness ${dshVersion}, but this was built against ${HARNESS_VERSION}`, 'Run `npm run setup` — it installs the pinned version.')
else bad('DeepSeek Harness is not installed', 'Run `npm run setup`.')

// ── the profile wiring ──────────────────────────────────────────────────────

heading('Profile wiring')

for (const profile of PROFILES) {
  const manifest = join(dshHome, 'profiles', profile, 'package.json')
  if (!existsSync(manifest)) {
    bad(`the ${profile} profile has no package.json`, 'Run `npm run setup`.')
    continue
  }
  const dependency = JSON.parse(readFileSync(manifest, 'utf8')).dependencies?.[PLUGIN_PACKAGE]
  if (!dependency) {
    bad(`the ${profile} profile does not depend on our plugin package`, 'Run `npm run setup`.')
  } else if (!dependency.startsWith('link:')) {
    warn(`the ${profile} profile depends on our plugin as "${dependency}", not a link:`, 'Run `npm run setup` so plugin edits reach the browser without a reinstall.')
  } else {
    const target = resolve(dependency.slice('link:'.length))
    const here = join(repoRoot, 'plugins', PLUGIN_DIR)
    let same = false
    try {
      // A checkout under a path with spaces is linked through a junction (scripts/start.mjs); compare real paths.
      same = realpathSync(target).toLowerCase() === realpathSync(here).toLowerCase()
    } catch {
      same = false
    }
    if (same) ok(`the ${profile} profile points at this checkout`)
    else bad(`the ${profile} profile points at ${target}, not this checkout`, 'Run `npm run setup` — the path is baked in and this repo has moved or been re-cloned.')
  }

  const patch = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
  if (existsSync(patch)) {
    const written = readFileSync(patch, 'utf8')
    const source = readFileSync(join(repoRoot, 'profile', profile, 'cordis.patch.yml'), 'utf8')
    if (written.trim() === source.trim()) ok(`the ${profile} patch layer matches the tracked copy`)
    else warn(`the ${profile} patch layer differs from profile/${profile}/cordis.patch.yml`, 'Run `npm run setup` — the tracked copy is the source of truth and will overwrite it.')
  } else {
    bad(`the ${profile} profile has no cordis.patch.yml`, 'Run `npm run setup`.')
  }
}

const webManifest = join(dshHome, 'profiles', 'web', 'package.json')
if (existsSync(webManifest)) {
  const adopted = JSON.parse(readFileSync(webManifest, 'utf8')).dependencies?.[GENUI_PACKAGE]
  if (adopted === GENUI_VERSION) ok(`the web profile has ${GENUI_PACKAGE} at the pinned ${GENUI_VERSION}`)
  else if (adopted) bad(`the web profile has ${GENUI_PACKAGE} at "${adopted}", not the pinned ${GENUI_VERSION}`, 'Run `npm run setup`.')
  else bad(`the web profile does not have ${GENUI_PACKAGE}`, 'Run `npm run setup` — tables and charts in answers render through it.')
}

const workspaces = join(dshHome, 'storages', 'workspace.json')
if (existsSync(workspaces)) {
  const registry = JSON.parse(readFileSync(workspaces, 'utf8'))
  const paths = Object.values(registry.tables?.workspaces ?? {}).map((entry) => String(entry.path).toLowerCase())
  let expected = workspaceDir.toLowerCase()
  try {
    expected = realpathSync(workspaceDir).toLowerCase()
  } catch {
    // not created yet — the comparison below will say so
  }
  if (paths.includes(expected)) ok('the Stratum workspace is registered, so the composer can start a session')
  else warn('a workspace is registered, but not the Stratum one', 'Run `npm run setup` — a workspace inside the checkout would load the developer notes into the transcript.')
} else {
  bad('no workspace is registered', 'Run `npm run setup` — without one the composer will not send.')
}

// ── what the sovereignty claim rests on ─────────────────────────────────────

heading('The seal')

const webPatch = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
if (existsSync(webPatch)) {
  const patch = readFileSync(webPatch, 'utf8')
  const provider = patch.match(/provider:\s*(\w+)/)?.[1]
  if (provider === 'local') ok('the model plane is set to the local provider — real inference on this GPU')
  else if (provider === 'replay') ok('the model plane is set to the replay provider — plain chat comes from the authored cache')
  else if (provider) bad(`the model plane is set to "${provider}", which reaches off this machine`, 'Check profile/web/cordis.patch.yml.')
  else warn('could not read which model provider the profile selects', 'Check profile/web/cordis.patch.yml by hand.')

  const endpoint = patch.match(/endpoint:\s*(\S+)/)?.[1]
  if (endpoint && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(endpoint)) ok(`the backend endpoint is loopback (${endpoint})`)
  else bad(`the backend endpoint is ${endpoint ?? 'not set'}, not loopback`, 'Check profile/web/cordis.patch.yml. The plugin refuses a non-loopback endpoint anyway.')

  if (/web-search/.test(patch) && /disabled:\s*true/.test(patch)) ok('the web-search tool is disabled in the profile')
  else warn('could not confirm the web-search tool is disabled', 'Open the tool list in the running workbench and check it by eye.')
} else {
  bad('the web profile has no patch layer, so nothing is sealed', 'Run `npm run setup`.')
}

// ── the backend and the model runtime ───────────────────────────────────────

heading('Backend and models')

if (existsSync(VENV_PYTHON)) ok(`the Python environment is at ${dirname(dirname(VENV_PYTHON))}`)
else warn(`no Python environment at ${VENV_PYTHON}`, 'run.bat creates it with `uv` on first start.')

const health = await getJson(`http://127.0.0.1:${BACKEND_PORT}/v1/health`)
if (health?.ok) {
  ok(`the backend is answering on :${BACKEND_PORT} — ${health.documents} documents, ${health.facts?.total ?? 0} facts (${health.facts?.flagged ?? 0} flagged)`)
  if (health.llm?.ok) ok(`the backend reaches the model runtime — ${(health.llm.models ?? []).join(', ')}`)
  else warn('the backend cannot reach the model runtime', 'Figures and tables still work; wording and PQ parts (c) need it. Start it with run.bat.')
} else {
  warn(`the backend is not answering on :${BACKEND_PORT}`, 'That is fine if you have not started it. Run run.bat.')
}

const models = await getJson(`http://127.0.0.1:${LLM_PORT}/v1/models`)
if (models?.data) {
  const names = models.data.map((entry) => entry.id)
  if (names.includes('st-text')) ok(`llama-swap is answering on :${LLM_PORT} — ${names.join(', ')}`)
  else warn(`llama-swap is on :${LLM_PORT} but does not list st-text (${names.join(', ') || 'no models'})`, 'Run `run.bat models` to write stratum.yaml.')
} else {
  warn(`llama-swap is not answering on :${LLM_PORT}`, 'That is fine if you have not started it. Run run.bat.')
}

// ── our own tests ───────────────────────────────────────────────────────────

heading('Our own tests')

const unitRan = spawnSync('node', ['--test'], { cwd: join(repoRoot, 'plugins', PLUGIN_DIR), encoding: 'utf8' })
const passed = (unitRan.stdout || '').match(/^# pass (\d+)$/m)?.[1]
const failed = (unitRan.stdout || '').match(/^# fail (\d+)$/m)?.[1]
if (unitRan.status === 0 && passed) ok(`${passed} plugin tests pass`)
else bad(`the plugin tests did not pass (${failed ?? '?'} failing)`, 'Run `npm test` to see which.')

if (existsSync(VENV_PYTHON)) {
  const backendRan = spawnSync(VENV_PYTHON, ['-m', 'pytest', 'tests', '-q'], { cwd: join(repoRoot, 'backend'), encoding: 'utf8' })
  const summary = (backendRan.stdout || '').trim().split(/\r?\n/).at(-1)
  if (backendRan.status === 0) ok(`backend tests pass (${summary})`)
  else bad('the backend tests did not pass', 'Run `npm run test:backend` to see which.')
}

if (existsSync(join(repoRoot, 'scripts', 'licence-audit.mjs'))) {
  const audit = spawnSync('node', [join(repoRoot, 'scripts', 'licence-audit.mjs')], { encoding: 'utf8' })
  if (audit.status === 0) ok('the licence audit passes')
  else warn('the licence audit reports findings', `Run \`npm run licence-audit\` to see them.\n         ${(audit.stdout || audit.stderr || '').split('\n').filter(Boolean).slice(-2).join('\n         ')}`)
}

// ── is it up? ───────────────────────────────────────────────────────────────

heading('Is the workbench running?')

try {
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })
  if (response.ok) {
    ok(`answering on http://127.0.0.1:${port}`)
    const proxied = await getJson(`http://127.0.0.1:${port}/stratum/api/health`)
    if (proxied?.ok) ok('the same-origin backend proxy works (/stratum/api/health)')
    else warn('the workbench is up but its backend proxy did not answer', 'Start the backend (run.bat) and reload.')
  } else {
    warn(`something is on port ${port} but returned HTTP ${response.status}`)
  }
} catch {
  warn(`nothing is serving on port ${port}`, 'That is fine if you have not started it. Run run.bat.')
}

// ── the verdict ─────────────────────────────────────────────────────────────

const failures = results.filter((result) => result.level === 'fail')
const notes = results.filter((result) => result.level === 'warn')

console.log('')
if (failures.length === 0) {
  console.log(`All ${results.filter((r) => r.level === 'ok').length} checks passed${notes.length ? `, with ${notes.length} note${notes.length === 1 ? '' : 's'} above` : ''}.`)
  console.log('This install is working. Start it with run.bat.')
} else {
  console.log(`${failures.length} check${failures.length === 1 ? '' : 's'} failed:`)
  for (const failure of failures) console.log(`  - ${failure.section}: ${failure.message}`)
  console.log('\nEach failure above says what to run. Most are fixed by `npm run setup`.')
}
process.exit(failures.length === 0 ? 0 : 1)

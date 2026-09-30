#!/usr/bin/env node
// Stratum — licence audit. Permissive licences only (PyMuPDF is banned).
//
//   npm run licence-audit             # print the report, exit non-zero on a banned licence
//   npm run licence-audit -- --write  # also regenerate the Python table in THIRD_PARTY_NOTICES.md
//
// Three trees make up what ships: the plugin (plugins/stratum-ui — dependency-free, MIT), the harness it runs
// on (MIT, pinned), and the Python backend's environment. The first has nothing to enumerate; the third is
// read by backend/scripts/licence_audit.py from the environment that actually runs the backend.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './stratum-config.mjs'

const python = ['D:\\stratum\\venv\\Scripts\\python.exe', join(repoRoot, 'backend', '.venv', 'Scripts', 'python.exe'), join(repoRoot, 'backend', '.venv', 'bin', 'python')].find(existsSync)
if (!python) {
  console.error('No Python environment found. Start the backend once (run.bat) so `uv` creates it, then re-run.')
  process.exit(2)
}

const script = join(repoRoot, 'backend', 'scripts', 'licence_audit.py')
const report = spawnSync(python, [script], { encoding: 'utf8' })
process.stdout.write(report.stdout || '')
if (report.stderr) process.stderr.write(report.stderr)

// The plugin must stay dependency-free: a runtime dependency is a licence to audit.
const plugin = JSON.parse(readFileSync(join(repoRoot, 'plugins', 'stratum-ui', 'package.json'), 'utf8'))
const runtimeDeps = Object.keys(plugin.dependencies ?? {})
if (runtimeDeps.length > 0) {
  console.log(`  NOTE      the plugin declares runtime dependencies (${runtimeDeps.join(', ')}); each needs an audit`)
} else {
  console.log('plugins/stratum-ui: no runtime dependencies (MIT)')
}

if (process.argv.includes('--write')) {
  const table = spawnSync(python, [script, '--markdown'], { encoding: 'utf8' }).stdout
  const target = join(repoRoot, 'THIRD_PARTY_NOTICES.md')
  const current = readFileSync(target, 'utf8')
  const marker = '<!-- python-table -->'
  const start = current.indexOf(marker)
  if (start === -1) {
    console.error(`THIRD_PARTY_NOTICES.md has no ${marker} marker; nothing written.`)
    process.exit(2)
  }
  const end = current.indexOf('<!-- /python-table -->')
  const next = `${current.slice(0, start)}${marker}\n${table}${current.slice(end === -1 ? start + marker.length : end)}`
  writeFileSync(target, next.endsWith('\n') ? next : `${next}\n`, 'utf8')
  console.log('THIRD_PARTY_NOTICES.md: Python table regenerated')
}

process.exit(report.status ?? 1)

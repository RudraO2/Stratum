// One place for every name, port and path Stratum's scripts share.
// Faraday (SIH26117) runs on the same machine with ~/.dsh, :3080 and :8080;
// Stratum keeps its own home and ports so the two never collide.

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCT = 'Stratum'
export const PLUGIN_PACKAGE = '@stratum/dsh-client-ui-base'
export const PLUGIN_DIR = 'stratum-ui'
export const HARNESS_VERSION = '0.1.1-rc.2'
export const GENUI_PACKAGE = '@changfenhuang/dsh-genui'
export const GENUI_VERSION = '0.9.3'

export const WEB_PORT = Number(process.env.STRATUM_PORT || 3090)
export const BACKEND_PORT = Number(process.env.STRATUM_BACKEND_PORT || 8642)
export const LLM_PORT = Number(process.env.STRATUM_LLM_PORT || 8090)

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const dshHome = (process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh-stratum')
/** The harness workspace. Outside the checkout on purpose: the harness loads CLAUDE.md-style files it finds above the workspace into the transcript. */
export const workspaceDir = (process.env.STRATUM_WORKSPACE || '').trim() || join(homedir(), '.stratum', 'workspace')
export const kioskProfileDir = join(homedir(), '.stratum', 'kiosk-browser-profile')

/** Environment every child process gets, so the harness always reads Stratum's home. */
export const childEnv = { ...process.env, DSH_HOME: dshHome }

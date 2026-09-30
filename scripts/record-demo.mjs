#!/usr/bin/env node
// Stratum — record the demo run.
//
// `npm run record-demo` drives the running workbench through the demo storyline
// (plan.md section 10) and records what the screen actually did:
//
//   the library and its flagged figure -> an exact table, every number a link to
//   its cell -> the review queue -> a "why" question answered from facts and
//   documents -> a parliamentary reply with a past-reply warning -> a report ->
//   topics -> measured metrics -> the seal, reading zero.
//
// It is a recording of the real workbench, not a montage: every frame comes
// from Chrome's own screencast of the page, every step waits on a real DOM
// condition rather than a sleep, and the run fails loudly instead of producing a
// video of something that did not happen. Model waits (a model loading onto the
// GPU) are real, so gaps of more than 8 seconds between frames are held to 2
// seconds in the video; the evidence file records the real duration.
//
// Node builtins only, by policy: the Chrome DevTools Protocol is spoken over the
// platform's own `WebSocket` and `fetch` rather than through a client library.
// The one external tool is the `ffmpeg` CLI, which muxes the captured frames into
// an MP4; it is build-time only and never ships.
//
// Usage:
//   run.bat windowed                # in another terminal — backend, models and workbench must be up
//   npm run record-demo             # records at 127.0.0.1:3090 in the light theme
//   npm run record-demo -- --theme dark
//
// Flags:
//   --port <n>       workbench port (default 3090)
//   --theme <t>      `light` or `dark` (default light) — chosen through the
//                    workbench's own Settings dialog, and put back to the
//                    operator's choice when the run ends
//   --out <path>     output MP4 (default videos/recorded-demo/stratum-demo-<theme>.mp4)
//   --stills <dir>   where the per-beat PNGs go (default docs/screenshots)
//   --keep-frames    leave the captured JPEG frames on disk for inspection

import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Chrome, in the two places Windows puts it. The recorder needs a real browser, not a shim. */
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
]

/** The recorded viewport. Both even, so H.264 needs no padding. */
const VIEWPORT = { width: 1440, height: 900 }

/** How long any single wait-for-condition may take before the run is called failed. */
const STEP_TIMEOUT_MS = 30_000

/** A turn can include a model loading onto a 4 GB GPU, so a single answer may take a while. */
const TURN_TIMEOUT_MS = 180_000

/** The real-time ceiling for the whole run. */
const MAX_DURATION_S = 900

/** Gaps between frames longer than this are idle waits (a model loading); the video holds them for HELD_WAIT_S. */
const LONG_WAIT_S = 8
const HELD_WAIT_S = 2
const MAX_HOLD_S = HELD_WAIT_S

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const port = flag('port', '3090')
const theme = flag('theme', 'light')
const keepFrames = args.includes('--keep-frames')
const workbenchUrl = `http://127.0.0.1:${port}/`
const stillsDir = resolve(repoRoot, flag('stills', 'docs/screenshots'))
const outPath = resolve(
  repoRoot,
  flag('out', `videos/recorded-demo/stratum-demo-${theme}.mp4`),
)

if (theme !== 'light' && theme !== 'dark') fail(`--theme must be "light" or "dark", not "${theme}"`)

const say = (message) => console.log(message)
const step = (message) => console.log(`\n==> ${message}`)

function fail(message) {
  console.error(`\nRecording stopped: ${message}\n`)
  process.exit(1)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** An ephemeral port for Chrome's debugging endpoint, so two runs never collide. */
function freePort() {
  return new Promise((done) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port: chosen } = server.address()
      server.close(() => done(chosen))
    })
  })
}

/**
 * A Chrome DevTools Protocol connection to one page target.
 *
 * Thin on purpose: `send` for commands, `on` for events. Everything the demo
 * needs — evaluating a predicate, typing, clicking, screencasting — is one of
 * those two.
 */
class Devtools {
  /** @param {string} webSocketUrl */
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.ready = new Promise((done, reject) => {
      this.socket.addEventListener('open', () => done(), { once: true })
      this.socket.addEventListener('error', () => reject(new Error('the DevTools socket refused the connection')), {
        once: true,
      })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const settle = this.pending.get(message.id)
        if (!settle) return
        this.pending.delete(message.id)
        if (message.error) settle.reject(new Error(`${message.error.message} (CDP)`))
        else settle.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
    })
  }

  /** @param {string} method @param {object} [params] */
  send(method, params = {}) {
    const id = this.nextId++
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve_, reject) => this.pending.set(id, { resolve: resolve_, reject }))
  }

  /** @param {string} method @param {(params: any) => void} listener */
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(listener)
  }

  close() {
    try {
      this.socket.close()
    } catch {
      /* the browser is going away anyway */
    }
  }
}

/** Poll `/json/version` until Chrome's debugging endpoint answers, or give up. */
async function waitForDevtools(debugPort) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      /* not up yet */
    }
    await sleep(200)
  }
  fail('Chrome never opened its DevTools endpoint')
}

/** The page target Chrome opened for our URL. */
async function pageTarget(debugPort) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
    const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    if (page) return page
    await sleep(200)
  }
  fail('Chrome opened no page target')
}

async function main() {
  step('Checking what this needs')

  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
  if (!chrome) fail(`no Chrome found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
  say(`  Chrome: ${chrome}`)

  const ffmpegProbe = spawnSync('ffmpeg', ['-version'], { shell: true, encoding: 'utf8' })
  if (ffmpegProbe.status !== 0) {
    fail(
      'ffmpeg is not on PATH. It muxes the captured frames into an MP4 and is build-time\n' +
        '  tooling only — see the FFmpeg row in docs/licence-decisions.json. Install it with\n' +
        '  `winget install Gyan.FFmpeg` and run this again.',
    )
  }
  say(`  ffmpeg: ${(ffmpegProbe.stdout || '').split('\n')[0]}`)

  try {
    const response = await fetch(workbenchUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    fail(
      `the workbench is not answering at ${workbenchUrl} (${error.message}).\n` +
        '  Start it in another terminal with `run.bat windowed` and run this again.',
    )
  }
  say(`  Workbench: ${workbenchUrl}`)

  const framesDir = mkdtempSync(join(tmpdir(), 'stratum-frames-'))
  const chromeProfile = mkdtempSync(join(tmpdir(), 'stratum-chrome-'))
  const debugPort = await freePort()

  step('Starting a clean headless Chrome')
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${chromeProfile}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  browser.on('error', (error) => fail(`Chrome would not start: ${error.message}`))

  const version = await waitForDevtools(debugPort)
  say(`  ${version.Browser}`)

  const target = await pageTarget(debugPort)
  const cdp = new Devtools(target.webSocketDebuggerUrl)
  await cdp.ready

  /** Frames as Chrome hands them over: base64 JPEG plus the wall-clock instant it painted. */
  /** @type {{ data: string, timestamp: number }[]} */
  const frames = []
  cdp.on('Page.screencastFrame', async (params) => {
    frames.push({ data: params.data, timestamp: params.metadata.timestamp })
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId })
    } catch {
      /* the screencast has already been stopped */
    }
  })

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  })

  /** Evaluate an expression in the page and hand back a plain value. */
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw in the page')
    }
    return result.result.value
  }

  /** Poll a page-side predicate until it is true. A timeout fails the run — a demo of something that did not happen is worse than no demo. */
  const waitFor = async (expression, description, timeout = STEP_TIMEOUT_MS) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await sleep(150)
    }
    throw new Error(`timed out after ${timeout / 1000}s waiting for ${description}`)
  }

  /** Type into the focused composer one character at a time, so the recording shows typing rather than a paste. */
  const typeText = async (text) => {
    for (const character of text) {
      await cdp.send('Input.insertText', { text: character })
      await sleep(24)
    }
  }

  const pressEnter = async () => {
    // A moment on the typed prompt before it is sent: the request is half the
    // point of the routing beats, and an instantly-sent prompt is unreadable.
    await sleep(700)
    for (const type of ['keyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      })
    }
  }

  // ---------------------------------------------------------------- page-side helpers
  //
  // Selectors are aria-labels and visible text, never the harness's hashed CSS
  // module class names — those change whenever the harness is rebuilt and a
  // recorder that breaks on a rebuild is worse than no recorder.
  const PAGE_HELPERS = `
    globalThis.__st = {
      composer: () => document.querySelector('textarea'),
      // Exact text, for the controls whose label is a prefix of another's —
      // Settings' "Close" against the details pane's "Close details".
      exact: (label) => [...document.querySelectorAll('button')].find((element) => (element.textContent || '').trim() === label),
      tab: (label) => [...document.querySelectorAll('[role="tab"]')].find((element) => (element.textContent || '').trim() === label),
      // The theme is a harness setting the server inlines into the document,
      // not a media query, so this is where the operator's current choice is.
      preference: () => {
        const boot = [...document.querySelectorAll('script')]
          .map((node) => node.textContent || '')
          .find((text) => /const preference = /.test(text));
        const found = boot && boot.match(/const preference = "(\\w+)"/);
        return found ? found[1] : null;
      },
      button: (pattern) => [...document.querySelectorAll('button')].find((element) =>
        new RegExp(pattern, 'i').test((element.getAttribute('aria-label') || '') + ' ' + (element.getAttribute('title') || '') + ' ' + (element.textContent || ''))),
      text: () => document.body.innerText,
      provider: () => {
        const node = [...document.querySelectorAll('[title]')].find((element) =>
          /Stratum is answering from the/.test(element.getAttribute('title')));
        return node ? { label: node.textContent.trim(), title: node.getAttribute('title') } : null;
      },
      egress: () => {
        const row = [...document.querySelectorAll('button')].find((element) => /^Egress monitor:/.test(element.getAttribute('aria-label') || ''));
        return row ? (row.textContent || '').replace(/\\s+/g, ' ').trim() : null;
      },
      routedModel: () => {
        const chip = [...document.querySelectorAll('button')].find((element) => /The router classified this as/.test(element.getAttribute('title') || ''));
        return chip ? chip.textContent.trim() : null;
      },
    };
    true;
  `

  /** The theme the operator had chosen before the recorder borrowed the setting. */
  let operatorTheme = null

  /**
   * Pick a theme through the workbench's own Settings dialog.
   *
   * `light` and `dark` are checkable — the harness marks the body — so they are
   * waited on rather than assumed. `system` is the operator's own choice
   * deferring to the machine, and there is nothing to assert about it beyond
   * the dialog having closed.
   */
  const chooseTheme = async (want) => {
    const label = { light: 'Light', dark: 'Dark', system: 'System' }[want]
    if (!label) throw new Error(`no Settings control for the ${want} theme`)
    await evaluate("__st.exact('Settings').click()")
    await waitFor(`!!__st.exact('${label}')`, 'the Settings dialog to open')
    await evaluate(`__st.exact('${label}').click()`)
    if (want !== 'system') {
      await waitFor(
        `document.body.hasAttribute('data-ds-dark-theme') === ${want === 'dark'}`,
        `the ${want} theme to be applied`,
      )
    }
    await evaluate("__st.exact('Close').click()")
    await waitFor("!__st.exact('Light')", 'the Settings dialog to close')
  }

  /** Put the operator's theme back. Runs on the way out of a good run and a failed one alike. */
  const restoreTheme = async () => {
    if (operatorTheme === null || operatorTheme === theme) return
    try {
      await chooseTheme(operatorTheme)
      say(`  The workbench is back on the ${operatorTheme} theme.`)
    } catch (error) {
      say(`  Could not put the ${operatorTheme} theme back (${error.message}) — set it in Settings.`)
    }
    operatorTheme = null
  }

  /** What the run observed, step by step. This is the evidence the checks below read, not a claim made afterwards. */
  const observations = []
  const beats = []
  let started = 0

  /** Sample the disclosed provider, the egress reading and the routed model at this instant. */
  const observe = async (label) => {
    const sample = await evaluate(
      `(() => ({ provider: __st.provider(), egress: __st.egress(), model: __st.routedModel() }))()`,
    )
    observations.push({ at: Number(((Date.now() - started) / 1000).toFixed(2)), label, ...sample })
    return sample
  }

  /** Mark a beat, sample what was on screen at it, and save a still. */
  const mark = async (id, label) => {
    const at = Number(((Date.now() - started) / 1000).toFixed(2))
    const sample = await observe(`beat ${id}`)
    beats.push({ id, label, at, provider: sample.provider?.label ?? null, egress: sample.egress, model: sample.model })
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(stillsDir, { recursive: true })
    writeFileSync(join(stillsDir, `demo-${id}-${theme}.png`), Buffer.from(shot.data, 'base64'))
    say(`  [${String(at).padStart(6)}s] ${label}`)
  }

  /** Type a request into the composer the way a person does, send it, and wait for the answer to land. */
  const ask = async (text, done, description, { instant = false } = {}) => {
    await evaluate('__st.composer().focus()')
    if (instant) await cdp.send('Input.insertText', { text })
    else await typeText(text)
    await pressEnter()
    await waitFor(done, description, TURN_TIMEOUT_MS)
    await sleep(2500)
  }

  /** A pause on a finished screen, long enough to read it. */
  const linger = (seconds) => sleep(seconds * 1000)

  const PQ_TEXT = [
    'LOK SABHA',
    'UNSTARRED QUESTION NO. 1234',
    'TO BE ANSWERED ON 05.08.2025',
    'COAL PRODUCTION BY SECL',
    'Will the Minister of COAL be pleased to state:',
    '(a) the coal production of South Eastern Coalfields Limited during the last three years;',
    '(b) whether the production target was achieved in 2023-24; and',
    '(c) the steps taken to improve evacuation?',
  ].join('\n')

  try {
    step('Recording')
    await cdp.send('Page.navigate', { url: workbenchUrl })
    // The helpers live on the document that actually loaded, so they go in
    // after the composer exists rather than before the navigation.
    await waitFor("!!document.querySelector('textarea')", 'the workbench to finish loading')
    await evaluate(PAGE_HELPERS)

    // The theme belongs to the operator, so the recorder asks for it the way an
    // operator does — through Settings — and puts the choice back when it is
    // done. Nothing here writes to the profile behind the workbench's back.
    operatorTheme = await evaluate('__st.preference()')
    if (operatorTheme === null) throw new Error('the workbench did not disclose which theme it is set to')
    say(`  The workbench is set to the ${operatorTheme} theme; recording in ${theme}.`)
    await chooseTheme(theme)

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1,
    })
    started = Date.now()
    await sleep(3000)
    await mark('00-workbench', 'Stratum, idle: the library, the seal, nothing else')

    // ---------------------------------------------------------------- 1. the library
    await evaluate("__st.button('^Library:').click()")
    await waitFor('/Add documents/i.test(__st.text()) && /Documents/i.test(__st.text())', 'the Library drawer to open')
    await waitFor('/sample-scanned-coal-directory/i.test(__st.text())', 'the sample documents to be listed')
    await linger(4)
    await mark('01-library', 'the library: what was read, and what a check flagged')
    await evaluate("__st.button('Close the library').click()")
    await sleep(800)

    // ---------------------------------------------------------------- 2. ask: an exact table
    await ask(
      'Give subsidiary-wise coal production for 2022-23 and 2023-24',
      '/Number guard/i.test(__st.text()) && /South Eastern Coalfields Limited/i.test(__st.text())',
      'the subsidiary-wise table to answer',
    )
    await waitFor('!!__st.routedModel()', 'the routing chip to name what answered')
    await linger(3)
    await mark('02-ask-table', 'a question answered as an exact table, every figure a link to its cell')

    // ---------------------------------------------------------------- 3. click a number: the source cell
    await evaluate("__st.button('Click to see the source cell').click()")
    await waitFor('/Read from/i.test(__st.text()) && /Checks/i.test(__st.text())', 'the Evidence tab to open at the cell')
    await linger(6)
    await mark('03-evidence-cell', 'the number, the page it came from, and every check it passed')

    // ---------------------------------------------------------------- 4. the review queue
    await evaluate("__st.tab('Facts').click()")
    await waitFor('/Needs review/i.test(__st.text()) && /A check failed/i.test(__st.text())', 'the Facts tab to open on the review queue')
    await linger(5)
    await mark('04-facts-review', 'the one figure a check refused to pass, waiting for a person')
    await evaluate("__st.tab('Chat').click()")
    await sleep(1200)

    // ---------------------------------------------------------------- 5. why: figures plus documents
    await ask(
      'Why did coal production of CIL increase in 2023-24?',
      '/Facts \\+ documents/i.test(__st.text()) && /Sources/i.test(__st.text())',
      'the mixed question to answer',
    )
    await linger(4)
    await mark('05-ask-why', 'the trend from verified facts, and the documents that explain it')

    // ---------------------------------------------------------------- 6. the PQ reply
    await ask(PQ_TEXT, '/Review before sending/i.test(__st.text()) && /\\.docx/i.test(__st.text())', 'the parliamentary reply to be drafted', {
      instant: true,
    })
    await linger(6)
    await mark('06-pq-reply', 'parts (a)(b)(c), and a warning that a figure differs from a past reply')

    // ---------------------------------------------------------------- 7. a report
    await ask(
      'Generate a target vs achievement report for FY2023-24',
      '/Achievement/i.test(__st.text()) && /Report saved|Word document/i.test(__st.text())',
      'the report to be generated',
    )
    await linger(5)
    await mark('07-report', 'a formatted Word report, written from verified facts')

    // ---------------------------------------------------------------- 8. topics
    await ask('Show me the topics in the library', '/Library topics/i.test(__st.text())', 'the topics to come back')
    await evaluate("__st.button('Open the Topics tab').click()")
    await waitFor('/Topics in the library/i.test(__st.text())', 'the Topics tab to open')
    await linger(5)
    await mark('08-topics', 'what the documents are about, with the word cloud')

    // ---------------------------------------------------------------- 9. metrics and the seal
    await evaluate("__st.tab('Metrics').click()")
    await waitFor('/Measured, not asserted/i.test(__st.text()) && /Routing accuracy/i.test(__st.text())', 'the Metrics tab to compute')
    await linger(6)
    await mark('09-metrics', 'measured percentages with their denominators')

    await evaluate("__st.button('^Egress monitor:').click()")
    await waitFor('/denied this session/i.test(__st.text())', 'the egress monitor to open')
    await linger(6)
    await mark('10-seal', 'the seal: nothing left the machine')

    await sleep(2000)
    await cdp.send('Page.stopScreencast')
    await restoreTheme()

    const durationS = Number(((Date.now() - started) / 1000).toFixed(2))

    // ---------------------------------------------------------------- what the run proves
    step('Checking the run against the story')

    // The provider is disclosed from the first turn onward, and it is the local one: real inference on this
    // machine, with no network path off the box. A run that cannot say which provider answered proves nothing.
    const afterSession = observations.filter((sample) => sample.at > beats.find((b) => b.id === '02-ask-table').at - 5)
    const notLocal = afterSession.filter((sample) => sample.provider !== null && !/^Local\b/.test(sample.provider.label))
    if (notLocal.length > 0) {
      throw new Error(`a provider other than local was disclosed at ${notLocal.map((sample) => `${sample.at}s (${sample.provider.label})`).join(', ')}`)
    }
    const unreadable = afterSession.filter((sample) => sample.provider === null)
    if (unreadable.length > 0) {
      throw new Error(`the provider disclosure was unreadable at ${unreadable.map((sample) => `${sample.at}s (${sample.label})`).join(', ')}`)
    }
    say(`  The workbench disclosed "${afterSession[0].provider.label}" at all ${afterSession.length} samples after the first question.`)

    // The claim of the last beat: across the whole run, nothing was denied because nothing tried to leave.
    const last = beats.at(-1)
    if (!/0 denied/i.test(last.egress ?? '') || !/Sealed/i.test(last.egress ?? '')) {
      throw new Error(`the egress row read "${last.egress}" at the end, not "Sealed · 0 denied"`)
    }
    say(`  The egress row reads "${last.egress}" at the end of the run.`)

    const routed = new Set(observations.map((sample) => sample.model).filter(Boolean))
    say(`  Routing chip readings: ${[...routed].join(' | ') || 'none'}.`)
    if (durationS > MAX_DURATION_S) {
      throw new Error(`the run took ${durationS}s, past the ${MAX_DURATION_S}s ceiling`)
    }
    say(`  The run is ${durationS}s of real time; idle waits are held to ${MAX_HOLD_S}s each in the video.`)

    // ---------------------------------------------------------------- mux
    step(`Encoding ${frames.length} captured frames`)
    if (frames.length < 30) fail(`only ${frames.length} frames were captured — the screencast did not run`)

    const manifest = []
    frames.forEach((frame, index) => {
      const name = `frame-${String(index).padStart(6, '0')}.jpg`
      writeFileSync(join(framesDir, name), Buffer.from(frame.data, 'base64'))
      // Chrome emits a frame only when the page repaints, so a still moment is
      // one frame held for a long time. Carrying the real gap through to the
      // concat list is what keeps the video the same length as the run.
      const next = frames[index + 1]
      const gap = next ? Math.max(0.033, next.timestamp - frame.timestamp) : 1.2
      const held = gap > LONG_WAIT_S ? HELD_WAIT_S : gap
      manifest.push(`file '${name}'`, `duration ${held.toFixed(3)}`)
    })
    // The concat demuxer ignores the duration of the last entry unless the file
    // is named once more after it.
    manifest.push(`file 'frame-${String(frames.length - 1).padStart(6, '0')}.jpg'`)
    const listPath = join(framesDir, 'frames.txt')
    writeFileSync(listPath, manifest.join('\n'))

    mkdirSync(dirname(outPath), { recursive: true })
    const encode = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath,
      ],
      { encoding: 'utf8' },
    )
    if (encode.status !== 0) fail(`ffmpeg failed:\n${encode.stderr || encode.stdout}`)

    const probe = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=noprint_wrappers=1', outPath],
      { encoding: 'utf8' },
    )
    const encoded = Object.fromEntries(
      (probe.stdout || '')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('=')),
    )

    const recordPath = join(dirname(outPath), `recording-${theme}.json`)
    writeFileSync(
      recordPath,
      `${JSON.stringify(
        {
          recorded: new Date().toISOString(),
          workbench: workbenchUrl,
          theme,
          viewport: VIEWPORT,
          chrome: version.Browser,
          durationS,
          idleWaitsHeldTo: `${HELD_WAIT_S}s for gaps over ${LONG_WAIT_S}s`,
          frames: frames.length,
          video: { path: outPath.slice(repoRoot.length + 1).replace(/\\/g, '/'), ...encoded },
          beats,
          observations,
        },
        null,
        2,
      )}\n`,
    )

    step('Done')
    say(`  Video      ${outPath}`)
    say(`  Evidence   ${recordPath}`)
    say(`  Stills     ${stillsDir}\\demo-*-${theme}.png`)
    if (keepFrames) say(`  Frames     ${framesDir}`)
  } catch (error) {
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      mkdirSync(stillsDir, { recursive: true })
      const wreck = join(stillsDir, `demo-failed-${theme}.png`)
      writeFileSync(wreck, Buffer.from(shot.data, 'base64'))
      say(`\n  The page as it stood when this failed: ${wreck}`)
    } catch {
      /* nothing more to learn from a page that will not screenshot */
    }
    await restoreTheme()
    cdp.close()
    browser.kill()
    fail(error.message)
  } finally {
    cdp.close()
    browser.kill()
    if (!keepFrames) rmSync(framesDir, { recursive: true, force: true })
    rmSync(chromeProfile, { recursive: true, force: true })
  }
}

await main()

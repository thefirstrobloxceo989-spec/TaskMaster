const { app, BrowserWindow, ipcMain, shell, systemPreferences } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const isMac = process.platform === 'darwin'
const recordingManager = createRecordingManager()
let apiServer = null
let apiBaseUrl = null

function createWindow() {
  const window = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    title: 'TaskMaster',
    icon: path.join(__dirname, '..', 'public', 'app-icon.svg'),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.loadFile(path.join(__dirname, '..', 'dist-desktop', 'index.html'))
}

function createJsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

function createErrorResponse(response, statusCode, message, details) {
  createJsonResponse(response, statusCode, {
    ok: false,
    error: message,
    details,
  })
}

function getRequestPath(request) {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  return decodeURIComponent(url.pathname)
}

function createApiServer() {
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    try {
      const requestPath = getRequestPath(request)

      if (request.method === 'GET' && requestPath === '/api/health') {
        createJsonResponse(response, 200, {
          ok: true,
          platform: process.platform,
          recording: recordingManager.getCurrent(),
          accessibilityTrusted: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : null,
          hookAvailable: await recordingManager.isHookAvailable(),
        })
        return
      }

      if (request.method === 'GET' && requestPath === '/api/recordings/current') {
        createJsonResponse(response, 200, recordingManager.getCurrent())
        return
      }

      if (request.method === 'POST' && requestPath === '/api/recordings/start') {
        createJsonResponse(response, 200, await recordingManager.start())
        return
      }

      if (request.method === 'POST' && requestPath === '/api/recordings/pause') {
        createJsonResponse(response, 200, recordingManager.pause())
        return
      }

      if (request.method === 'POST' && requestPath === '/api/recordings/resume') {
        createJsonResponse(response, 200, recordingManager.resume())
        return
      }

      if (request.method === 'POST' && requestPath === '/api/recordings/stop') {
        createJsonResponse(response, 200, await recordingManager.stop())
        return
      }

      if (request.method === 'GET' && requestPath === '/api/recordings') {
        createJsonResponse(response, 200, await recordingManager.list())
        return
      }

      const recordingMatch = requestPath.match(/^\/api\/recordings\/([^/]+)$/)
      if (recordingMatch && request.method === 'GET') {
        createJsonResponse(response, 200, await recordingManager.load(recordingMatch[1]))
        return
      }

      if (recordingMatch && request.method === 'DELETE') {
        createJsonResponse(response, 200, await recordingManager.delete(recordingMatch[1]))
        return
      }

      createErrorResponse(response, 404, 'Endpoint not found.')
    } catch (error) {
      createErrorResponse(response, error.statusCode || 500, error.message || 'API request failed.')
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

function runAppleScript(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (error, stdout) => {
      resolve({ ok: !error, message: error?.message, stdout: stdout.trim() })
    })
  })
}

function escapeAppleScriptText(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

async function getActiveWindowInfo() {
  if (!isMac) {
    return { appName: null, windowTitle: null }
  }

  const script = [
    'tell application "System Events"',
    'set frontApp to first application process whose frontmost is true',
    'set appName to name of frontApp',
    'set windowTitle to ""',
    'try',
    'set windowTitle to name of front window of frontApp',
    'end try',
    'return appName & linefeed & windowTitle',
    'end tell',
  ].join('\n')
  const result = await runAppleScript(script)
  if (!result.ok) {
    return { appName: null, windowTitle: null }
  }

  const [appName = '', windowTitle = ''] = result.stdout.split('\n')
  return {
    appName: appName || null,
    windowTitle: windowTitle || null,
  }
}

async function playNativeStep(step) {
  if (!isMac) {
    return {
      ok: false,
      message: 'Native replay is currently implemented for macOS only.',
    }
  }

  if (step.type === 'click' && Number.isFinite(step.screenX) && Number.isFinite(step.screenY)) {
    const x = Math.round(step.screenX)
    const y = Math.round(step.screenY)
    return runAppleScript(`tell application "System Events" to click at {${x}, ${y}}`)
  }

  if (step.type === 'keyboard' && step.key) {
    const modifiers = getAppleScriptModifiers(step)
    if (step.key.length === 1) {
      const modifierText = modifiers.length ? ` using {${modifiers.join(', ')}}` : ''
      return runAppleScript(
        `tell application "System Events" to keystroke "${escapeAppleScriptText(step.key)}"${modifierText}`,
      )
    }

    const keyCode = getAppleScriptKeyCode(step.key)
    if (keyCode !== null) {
      const modifierText = modifiers.length ? ` using {${modifiers.join(', ')}}` : ''
      return runAppleScript(`tell application "System Events" to key code ${keyCode}${modifierText}`)
    }
  }

  return { ok: false, message: `Unsupported native step: ${step.label || step.type}` }
}

function getAppleScriptModifiers(step) {
  const modifiers = []
  if (step.metaKey) modifiers.push('command down')
  if (step.ctrlKey) modifiers.push('control down')
  if (step.altKey) modifiers.push('option down')
  if (step.shiftKey) modifiers.push('shift down')
  return modifiers
}

function getAppleScriptKeyCode(key) {
  const codes = {
    Enter: 36,
    Backspace: 51,
    Tab: 48,
    Escape: 53,
    ' ': 49,
    ArrowLeft: 123,
    ArrowRight: 124,
    ArrowDown: 125,
    ArrowUp: 126,
    Delete: 117,
    Home: 115,
    End: 119,
    PageUp: 116,
    PageDown: 121,
    F1: 122,
    F2: 120,
    F3: 99,
    F4: 118,
    F5: 96,
    F6: 97,
    F7: 98,
    F8: 100,
    F9: 101,
    F10: 109,
    F11: 103,
    F12: 111,
  }
  return Object.prototype.hasOwnProperty.call(codes, key) ? codes[key] : null
}

function isTaskMasterEvent(event) {
  return event.appName === 'TaskMaster' || event.windowTitle === 'TaskMaster'
}

ipcMain.handle('taskmaster:get-desktop-info', () => ({
  platform: process.platform,
  accessibilityTrusted: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : null,
  apiBaseUrl,
}))

ipcMain.handle('taskmaster:get-api-base-url', () => apiBaseUrl)

ipcMain.handle('taskmaster:open-accessibility-settings', async () => {
  if (!isMac) return { ok: false, message: 'Accessibility settings are macOS-only.' }

  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  )
  return { ok: true }
})

ipcMain.handle('taskmaster:play-step', async (_event, step) => playNativeStep(step))

function createHttpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function createRecordingManager() {
  let status = 'idle'
  let currentSession = null
  let hookModulePromise = null
  let isHookStarted = false
  let lastEventAt = 0
  const pendingEventMetadata = new Set()

  const recordingsDir = () => path.join(app.getPath('userData'), 'recordings')

  const loadHook = async () => {
    if (!hookModulePromise) {
      hookModulePromise = Promise.resolve()
        .then(() => require.resolve('uiohook-napi'))
        .then((hookPath) => import(pathToFileURL(hookPath).href))
        .then((module) => module.uIOhook || module.default?.uIOhook || module.default || module)
        .catch((error) => {
          hookModulePromise = null
          throw createHttpError(
            503,
            `Global input hook is unavailable. Run npm install and restart the desktop app. ${error.message}`,
          )
        })
    }
    return hookModulePromise
  }

  const isHookAvailable = async () => {
    try {
      await loadHook()
      return true
    } catch {
      return false
    }
  }

  const getCurrent = () => ({
    id: currentSession?.id || null,
    status,
    startedAt: currentSession?.startedAt || null,
    eventCount: currentSession?.events.length || 0,
  })

  const ensureRecording = () => {
    if (!currentSession || status === 'idle') {
      throw createHttpError(409, 'No recording is currently running.')
    }
  }

  const removeHookListeners = async () => {
    const hook = await loadHook()
    if (typeof hook.removeAllListeners === 'function') {
      hook.removeAllListeners('mousedown')
      hook.removeAllListeners('mouseup')
      hook.removeAllListeners('mousemove')
      hook.removeAllListeners('keydown')
      hook.removeAllListeners('keyup')
      hook.removeAllListeners('wheel')
    }
  }

  const stopHook = async () => {
    const hook = await loadHook()
    await removeHookListeners()
    if (isHookStarted && typeof hook.stop === 'function') {
      hook.stop()
      isHookStarted = false
    }
  }

  const pushEvent = async (type, rawEvent) => {
    const session = currentSession
    if (!session || status !== 'recording') return

    const now = Date.now()
    const delay = lastEventAt ? Math.max(0, now - lastEventAt) : 0
    lastEventAt = now

    const event = {
      id: session.events.length + 1,
      type,
      delay,
      timestamp: new Date(now).toISOString(),
      x: Number.isFinite(rawEvent.x) ? rawEvent.x : null,
      y: Number.isFinite(rawEvent.y) ? rawEvent.y : null,
      button: Number.isFinite(rawEvent.button) ? rawEvent.button : null,
      clicks: Number.isFinite(rawEvent.clicks) ? rawEvent.clicks : null,
      keycode: Number.isFinite(rawEvent.keycode) ? rawEvent.keycode : null,
      rawcode: Number.isFinite(rawEvent.rawcode) ? rawEvent.rawcode : null,
      amount: Number.isFinite(rawEvent.amount) ? rawEvent.amount : null,
      direction: Number.isFinite(rawEvent.direction) ? rawEvent.direction : null,
      altKey: Boolean(rawEvent.altKey),
      ctrlKey: Boolean(rawEvent.ctrlKey),
      metaKey: Boolean(rawEvent.metaKey),
      shiftKey: Boolean(rawEvent.shiftKey),
      appName: null,
      windowTitle: null,
    }
    session.events.push(event)

    const metadataPromise = getActiveWindowInfo()
      .then((activeWindow) => {
        event.appName = activeWindow.appName
        event.windowTitle = activeWindow.windowTitle
      })
      .catch(() => {})
      .finally(() => {
        pendingEventMetadata.delete(metadataPromise)
      })
    pendingEventMetadata.add(metadataPromise)
  }

  const start = async () => {
    if (status !== 'idle') {
      throw createHttpError(409, 'A recording is already running.')
    }

    const hook = await loadHook()
    const startedAt = new Date().toISOString()
    const id = `recording-${startedAt.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}`
    currentSession = {
      id,
      version: 1,
      platform: process.platform,
      startedAt,
      stoppedAt: null,
      events: [],
    }
    status = 'recording'
    lastEventAt = Date.now()

    await removeHookListeners()
    hook.on('mousedown', (event) => void pushEvent('mouseDown', event))
    hook.on('mouseup', (event) => void pushEvent('mouseUp', event))
    hook.on('keydown', (event) => void pushEvent('keyDown', event))
    hook.on('keyup', (event) => void pushEvent('keyUp', event))
    hook.on('wheel', (event) => void pushEvent('wheel', event))

    if (!isHookStarted && typeof hook.start === 'function') {
      hook.start()
      isHookStarted = true
    }

    return getCurrent()
  }

  const pause = () => {
    ensureRecording()
    if (status === 'paused') {
      throw createHttpError(409, 'Recording is already paused.')
    }
    status = 'paused'
    return getCurrent()
  }

  const resume = () => {
    ensureRecording()
    if (status !== 'paused') {
      throw createHttpError(409, 'Recording is not paused.')
    }
    lastEventAt = Date.now()
    status = 'recording'
    return getCurrent()
  }

  const stop = async () => {
    ensureRecording()
    const session = currentSession
    session.stoppedAt = new Date().toISOString()
    status = 'idle'
    currentSession = null
    lastEventAt = 0
    await stopHook()
    await Promise.allSettled([...pendingEventMetadata])
    session.events = session.events.filter((event) => !isTaskMasterEvent(event))

    await fs.mkdir(recordingsDir(), { recursive: true })
    const fileName = `${session.id}.json`
    const finalPath = path.join(recordingsDir(), fileName)
    const tempPath = `${finalPath}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(session, null, 2))
    await fs.rename(tempPath, finalPath)

    return {
      id: session.id,
      status: 'saved',
      eventCount: session.events.length,
      path: finalPath,
    }
  }

  const list = async () => {
    await fs.mkdir(recordingsDir(), { recursive: true })
    const entries = await fs.readdir(recordingsDir(), { withFileTypes: true })
    const recordings = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const filePath = path.join(recordingsDir(), entry.name)
          const contents = await fs.readFile(filePath, 'utf8')
          const recording = JSON.parse(contents)
          return {
            id: recording.id,
            startedAt: recording.startedAt,
            stoppedAt: recording.stoppedAt,
            eventCount: Array.isArray(recording.events) ? recording.events.length : 0,
            filename: entry.name,
          }
        }),
    )
    return recordings.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
  }

  const load = async (id) => {
    const filePath = path.join(recordingsDir(), `${path.basename(id)}.json`)
    const contents = await fs.readFile(filePath, 'utf8')
    return JSON.parse(contents)
  }

  const deleteRecording = async (id) => {
    const filePath = path.join(recordingsDir(), `${path.basename(id)}.json`)
    await fs.unlink(filePath)
    return { ok: true, id }
  }

  return {
    delete: deleteRecording,
    getCurrent,
    isHookAvailable,
    list,
    load,
    pause,
    resume,
    start,
    stop,
    stopHook,
  }
}

app.whenReady().then(async () => {
  const api = await createApiServer()
  apiServer = api.server
  apiBaseUrl = api.baseUrl
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  apiServer?.close()
  void recordingManager.stopHook().catch(() => {})
})

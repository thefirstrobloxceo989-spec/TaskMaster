const { app, BrowserWindow, ipcMain, shell, systemPreferences } = require('electron')
const { execFile } = require('node:child_process')
const path = require('node:path')

const isMac = process.platform === 'darwin'

function createWindow() {
  const window = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    title: 'Taskmaster',
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

function runAppleScript(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (error) => {
      resolve({ ok: !error, message: error?.message })
    })
  })
}

function escapeAppleScriptText(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
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
    if (step.key.length === 1 && !step.ctrlKey && !step.altKey && !step.metaKey) {
      return runAppleScript(
        `tell application "System Events" to keystroke "${escapeAppleScriptText(step.key)}"`,
      )
    }

    if (step.key === 'Enter') {
      return runAppleScript('tell application "System Events" to key code 36')
    }

    if (step.key === 'Backspace') {
      return runAppleScript('tell application "System Events" to key code 51')
    }

    if (step.key === 'Tab') {
      return runAppleScript('tell application "System Events" to key code 48')
    }
  }

  return { ok: false, message: `Unsupported native step: ${step.label || step.type}` }
}

ipcMain.handle('taskmaster:get-desktop-info', () => ({
  platform: process.platform,
  accessibilityTrusted: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : null,
}))

ipcMain.handle('taskmaster:open-accessibility-settings', async () => {
  if (!isMac) return { ok: false, message: 'Accessibility settings are macOS-only.' }

  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  )
  return { ok: true }
})

ipcMain.handle('taskmaster:play-step', async (_event, step) => playNativeStep(step))

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

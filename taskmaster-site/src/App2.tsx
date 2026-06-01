import './App2.css'
import { useCallback, useEffect, useRef, useState } from 'react'

type RepeatMode = 'times' | 'seconds' | 'minutes'
type ActionStatus = 'idle' | 'running' | 'paused' | 'stopping'
type TabControlMessage = { type: 'hello' | 'peer' | 'stop' | 'pause' | 'resume' | 'clear' }
type TabRunMessage = {
  type: 'run'
  steps: RecordedStep[]
  repeatValue: string
  repeatMode: RepeatMode
}
type OutboundTabMessage = TabControlMessage | TabRunMessage
type TabMessage =
  | (TabControlMessage & { senderId: string })
  | {
      type: 'run'
      senderId: string
      steps: RecordedStep[]
      repeatValue: string
      repeatMode: RepeatMode
    }

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type RecordedStep = {
  id: number
  type: 'click' | 'keyboard'
  label: string
  delay: number
  selector?: string
  x?: number
  y?: number
  screenX?: number
  screenY?: number
  key?: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

const TAB_CHANNEL = 'taskmaster-tab-actions'

type DesktopInfo = {
  platform: string
  accessibilityTrusted: boolean | null
}

type NativeStepResult = {
  ok: boolean
  message?: string
}

declare global {
  interface Window {
    taskmasterDesktop?: {
      getInfo: () => Promise<DesktopInfo>
      openAccessibilitySettings: () => Promise<NativeStepResult>
      playStep: (step: RecordedStep) => Promise<NativeStepResult>
    }
  }
}

function App2() {
  const [showActionOptions, setShowActionOptions] = useState(false)
  const [repeatValue, setRepeatValue] = useState('3')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('times')
  const [isRecording, setIsRecording] = useState(false)
  const [isRecordingPaused, setIsRecordingPaused] = useState(false)
  const [recordedSteps, setRecordedSteps] = useState<RecordedStep[]>([])
  const [actionStatus, setActionStatus] = useState<ActionStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('Ready to record an action.')
  const [activityLog, setActivityLog] = useState<string[]>([])
  const [linkedTabCount, setLinkedTabCount] = useState(1)
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null)
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)

  const tabId = useRef(crypto.randomUUID())
  const channel = useRef<BroadcastChannel | null>(null)
  const linkedTabs = useRef(new Map<string, number>())
  const messageHandler = useRef<(message: TabMessage) => void>(() => {})
  const actionStatusRef = useRef<ActionStatus>('idle')
  const lastRecordedAt = useRef(0)
  const stepId = useRef(1)
  const stopActionRequested = useRef(false)
  const actionPaused = useRef(false)
  const actionRunning = useRef(false)

  const addLog = useCallback((message: string) => {
    setActivityLog((items) => [message, ...items].slice(0, 8))
  }, [])

  const broadcast = useCallback((message: OutboundTabMessage) => {
    channel.current?.postMessage({ ...message, senderId: tabId.current })
  }, [])

  const updateActionStatus = (status: ActionStatus) => {
    actionStatusRef.current = status
    setActionStatus(status)
  }

  useEffect(() => {
    if (!('BroadcastChannel' in window)) {
      return
    }

    const syncChannel = new BroadcastChannel(TAB_CHANNEL)
    channel.current = syncChannel

    const markLinkedTab = (peerId: string) => {
      linkedTabs.current.set(peerId, Date.now())
      setLinkedTabCount(linkedTabs.current.size + 1)
    }

    const announce = () => {
      syncChannel.postMessage({ type: 'hello', senderId: tabId.current })
    }

    syncChannel.onmessage = (event: MessageEvent<TabMessage>) => {
      const message = event.data
      if (!message || message.senderId === tabId.current) return

      if (message.type === 'hello') {
        markLinkedTab(message.senderId)
        syncChannel.postMessage({ type: 'peer', senderId: tabId.current })
        return
      }

      if (message.type === 'peer') {
        markLinkedTab(message.senderId)
        return
      }

      messageHandler.current(message)
    }

    announce()
    const interval = window.setInterval(() => {
      announce()

      const staleBefore = Date.now() - 8000
      for (const [peerId, lastSeen] of linkedTabs.current) {
        if (lastSeen < staleBefore) linkedTabs.current.delete(peerId)
      }
      setLinkedTabCount(linkedTabs.current.size + 1)
    }, 3000)

    return () => {
      window.clearInterval(interval)
      syncChannel.close()
      channel.current = null
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    window.taskmasterDesktop?.getInfo().then((info) => {
      if (!isMounted) return
      setDesktopInfo(info)
      addLog('Desktop app mode enabled')
    })

    return () => {
      isMounted = false
    }
  }, [addLog])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      addLog('App install is available')
    }

    const handleInstalled = () => {
      setInstallPrompt(null)
      setStatusMessage('Taskmaster is installed as an app.')
      addLog('App installed')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [addLog])

  useEffect(() => {
    if (!isRecording) return

    const recordStep = (stepData: Omit<RecordedStep, 'id' | 'delay'>) => {
      if (isRecordingPaused) return
      const now = Date.now()
      const delay = Math.max(160, now - lastRecordedAt.current)
      lastRecordedAt.current = now
      const step = { id: stepId.current, delay, ...stepData }
      stepId.current += 1
      setRecordedSteps((steps) => [...steps, step])
      addLog(`Recorded ${stepData.label}`)
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('.app2-controls')) return
      const targetName = describeTarget(target)
      recordStep({
        type: 'click',
        label: `click ${targetName} at ${Math.round(event.clientX)}, ${Math.round(event.clientY)}`,
        selector: getTargetSelector(target),
        x: event.clientX,
        y: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
      })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('.app2-controls')) return
      recordStep({
        type: 'keyboard',
        label: `press ${formatShortcut(event)}`,
        selector: getTargetSelector(event.target as HTMLElement),
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
      })
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [addLog, isRecording, isRecordingPaused])

  const startRecording = () => {
    stepId.current = 1
    lastRecordedAt.current = Date.now()
    setRecordedSteps([])
    setIsRecording(true)
    setIsRecordingPaused(false)
    setStatusMessage('Recording browser-window clicks, exact areas, and keyboard shortcuts.')
    addLog('Recording started')
  }

  const stopRecording = () => {
    if (!isRecording) {
      setStatusMessage('No recording is currently running.')
      return
    }
    setIsRecording(false)
    setIsRecordingPaused(false)
    setStatusMessage(`Recording stopped with ${recordedSteps.length} step(s).`)
    addLog('Recording stopped')
  }

  const pauseRecording = () => {
    if (!isRecording) {
      setStatusMessage('Start recording before pausing.')
      return
    }
    setIsRecordingPaused(true)
    setStatusMessage('Recording paused.')
    addLog('Recording paused')
  }

  const resumeRecording = () => {
    if (!isRecording) {
      setStatusMessage('Start recording before resuming.')
      return
    }
    lastRecordedAt.current = Date.now()
    setIsRecordingPaused(false)
    setStatusMessage('Recording resumed.')
    addLog('Recording resumed')
  }

  const runAction = () => {
    broadcast({
      type: 'run',
      steps: recordedSteps,
      repeatValue,
      repeatMode,
    })
    void executeAction(recordedSteps, repeatValue, repeatMode, 'Action')
  }

  const executeAction = async (
    steps: RecordedStep[],
    amountText: string,
    mode: RepeatMode,
    sourceName: string,
  ) => {
    const amount = Number(amountText)
    if (actionRunning.current) {
      setStatusMessage('Action is already running.')
      return
    }
    if (!steps.length) {
      setStatusMessage('Record at least one step before running an action.')
      return
    }
    if (!Number.isFinite(amount) || amount < 1) {
      setStatusMessage('Choose a repeat amount of 1 or more.')
      return
    }

    stopActionRequested.current = false
    actionPaused.current = false
    actionRunning.current = true
    updateActionStatus('running')
    setStatusMessage(`${sourceName} is running.`)
    addLog(`${sourceName} started`)

    const startedAt = Date.now()
    const runUntil =
      mode === 'seconds'
        ? startedAt + amount * 1000
        : mode === 'minutes'
          ? startedAt + amount * 60 * 1000
          : null

    let cycle = 0
    while (!stopActionRequested.current) {
      if (runUntil && Date.now() >= runUntil) break
      if (!runUntil && cycle >= amount) break

      cycle += 1
      addLog(`${sourceName} cycle ${cycle}`)

      for (const step of steps) {
        if (stopActionRequested.current) break
        while (actionPaused.current && !stopActionRequested.current) {
          await wait(120)
        }
        await wait(step.delay)
        const didPlay = await playRecordedStep(step, Boolean(desktopInfo))
        addLog(`${didPlay ? 'Played' : 'Could not play'} ${step.label}`)
      }
    }

    actionRunning.current = false
    actionPaused.current = false
    updateActionStatus('idle')
    setStatusMessage(
      stopActionRequested.current
        ? `${sourceName} stopped.`
        : `${sourceName} finished after ${cycle} cycle(s).`,
    )
    addLog(`${sourceName} ended`)
  }

  const stopAction = () => {
    broadcast({ type: 'stop' })
    applyStopAction()
  }

  const applyStopAction = () => {
    if (actionStatusRef.current === 'idle') {
      setStatusMessage('No action is currently running.')
      return
    }
    stopActionRequested.current = true
    actionPaused.current = false
    updateActionStatus('stopping')
    setStatusMessage('Stopping action...')
    addLog('Stop action requested')
  }

  const pauseAction = () => {
    broadcast({ type: 'pause' })
    applyPauseAction()
  }

  const applyPauseAction = () => {
    if (actionStatusRef.current !== 'running') {
      setStatusMessage('Start an action before pausing it.')
      return
    }
    actionPaused.current = true
    updateActionStatus('paused')
    setStatusMessage('Action paused.')
    addLog('Action paused')
  }

  const resumeAction = () => {
    if (actionStatusRef.current === 'running') {
      setStatusMessage('Action is already running.')
      return
    }
    if (actionStatusRef.current === 'idle') {
      runAction()
      return
    }
    broadcast({ type: 'resume' })
    applyResumeAction()
  }

  const applyResumeAction = () => {
    if (actionStatusRef.current === 'idle') {
      setStatusMessage('No paused action is available in this tab.')
      return
    }
    actionPaused.current = false
    updateActionStatus('running')
    setStatusMessage('Action resumed.')
    addLog('Action resumed')
  }

  const clearRecording = () => {
    broadcast({ type: 'clear' })
    applyClearRecording()
  }

  const applyClearRecording = () => {
    setRecordedSteps([])
    setIsRecording(false)
    setIsRecordingPaused(false)
    stepId.current = 1
    setStatusMessage('Recorded steps cleared.')
    addLog('Recording cleared')
  }

  const installApp = async () => {
    if (!installPrompt) {
      setStatusMessage(
        'Install is not available yet. Try after the site is served over HTTPS or use your browser install menu.',
      )
      return
    }

    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallPrompt(null)
    setStatusMessage(
      choice.outcome === 'accepted'
        ? 'Taskmaster is installing as an app.'
        : 'App install was dismissed.',
    )
    addLog(`Install ${choice.outcome}`)
  }

  const openAccessibilitySettings = async () => {
    const result = await window.taskmasterDesktop?.openAccessibilitySettings()
    if (!result?.ok) {
      setStatusMessage(result?.message || 'Accessibility settings are not available here.')
      return
    }

    setStatusMessage('Enable Taskmaster in Accessibility, then restart the app if needed.')
    addLog('Opened Accessibility settings')
  }

  useEffect(() => {
    messageHandler.current = (message: TabMessage) => {
      if (message.type === 'run') {
        setRecordedSteps(message.steps)
        setRepeatValue(message.repeatValue)
        setRepeatMode(message.repeatMode)
        void executeAction(message.steps, message.repeatValue, message.repeatMode, 'Tab action')
        return
      }

      if (message.type === 'stop') {
        applyStopAction()
        return
      }

      if (message.type === 'pause') {
        applyPauseAction()
        return
      }

      if (message.type === 'resume') {
        applyResumeAction()
        return
      }

      if (message.type === 'clear') {
        applyClearRecording()
      }
    }
  })

  const hasRecordedSteps = recordedSteps.length > 0
  const isDesktopApp = Boolean(desktopInfo)
  const recordingStatusText = isRecordingPaused
    ? 'Recording paused'
    : isRecording
      ? 'Recording'
      : 'Recorder idle'
  const actionStatusText =
    actionStatus === 'paused'
      ? 'Action paused'
      : actionStatus === 'stopping'
        ? 'Action stopping'
      : actionStatus === 'running'
        ? 'Action running'
        : 'Action idle'

  return (
    <main className="app2-shell">
      <header className="landing-copy">
        <h1>Taskmaster</h1>
        <p>
          An AI automation tool that will forever revolutionize the automation
          industry.
        </p>
      </header>
      <section className="glass-bar app2-controls" aria-label="Task controls">
        <div className="button-row" aria-label="Recording controls">
          <button
            type="button"
            className="glass-button"
            onClick={startRecording}
            disabled={isRecording}
          >
            Record
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={stopRecording}
            disabled={!isRecording}
          >
            Stop
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={pauseRecording}
            disabled={!isRecording || isRecordingPaused}
          >
            Pause
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={resumeRecording}
            disabled={!isRecording || !isRecordingPaused}
          >
            Resume
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={clearRecording}
            disabled={!hasRecordedSteps && !isRecording}
          >
            Clear
          </button>
          <button type="button" className="glass-button" onClick={installApp}>
            Install App
          </button>
          {isDesktopApp && (
            <button
              type="button"
              className="glass-button"
              onClick={openAccessibilitySettings}
            >
              Permissions
            </button>
          )}
        </div>
        <div className="button-row" aria-label="Action controls">
          <div className="action-control">
            <button
              type="button"
              className="glass-button"
              aria-expanded={showActionOptions}
              aria-controls="action-repeat-options"
              onClick={() => setShowActionOptions((isShown) => !isShown)}
            >
              Action Settings
            </button>
            {showActionOptions && (
              <div id="action-repeat-options" className="repeat-options">
                <input
                  type="number"
                  min="1"
                  value={repeatValue}
                  aria-label="Repeat amount"
                  onChange={(event) => setRepeatValue(event.target.value)}
                />
                <select
                  value={repeatMode}
                  aria-label="Repeat mode"
                  onChange={(event) =>
                    setRepeatMode(event.target.value as RepeatMode)
                  }
                >
                  <option value="times">times</option>
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                </select>
              </div>
            )}
          </div>
          <button
            type="button"
            className="glass-button"
            onClick={stopAction}
            disabled={actionStatus === 'idle' || actionStatus === 'stopping'}
          >
            Stop Action
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={pauseAction}
            disabled={actionStatus !== 'running'}
          >
            Pause Action
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={resumeAction}
            disabled={!hasRecordedSteps || actionStatus === 'running' || actionStatus === 'stopping'}
          >
            {actionStatus === 'paused' ? 'Resume Action' : 'Run Action'}
          </button>
        </div>
      </section>
      <section className="automation-panel" aria-label="Automation status">
        <div className="status-row">
          <span className={isRecording ? 'status-dot active' : 'status-dot'} />
          <p>{statusMessage}</p>
        </div>
        <div className="state-row" aria-label="Current button states">
          <span>{recordingStatusText}</span>
          <span>{actionStatusText}</span>
          <span>
            {hasRecordedSteps
              ? `${recordedSteps.length} step${recordedSteps.length === 1 ? '' : 's'} ready`
              : 'No steps ready'}
          </span>
          <span>
            {linkedTabCount === 1
              ? '1 tab linked'
              : `${linkedTabCount} tabs linked`}
          </span>
          <span>{isDesktopApp ? 'Desktop app' : 'Web app'}</span>
          {desktopInfo?.accessibilityTrusted === false && (
            <span>Accessibility needed</span>
          )}
        </div>
        <p className="capture-note">
          The desktop app can replay native clicks and simple keys after macOS
          Accessibility permission is enabled. Full global recording still needs
          a native input hook helper.
        </p>
        <div className="automation-grid">
          <div>
            <h2>Recorded steps</h2>
            <ol className="step-list">
              {recordedSteps.length ? (
                recordedSteps.map((step) => (
                  <li key={step.id}>
                    {step.label}
                    <span>{Math.round(step.delay / 100) / 10}s</span>
                  </li>
                ))
              ) : (
                <li>No steps recorded yet.</li>
              )}
            </ol>
          </div>
          <div>
            <h2>Activity</h2>
            <ol className="step-list">
              {activityLog.length ? (
                activityLog.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
              ) : (
                <li>Nothing has happened yet.</li>
              )}
            </ol>
          </div>
        </div>
      </section>
    </main>
  )
}

async function playRecordedStep(step: RecordedStep, preferNative = false) {
  if (preferNative && window.taskmasterDesktop) {
    const result = await window.taskmasterDesktop.playStep(step)
    if (result.ok) return true
  }

  if (step.type === 'click' && step.x !== undefined && step.y !== undefined) {
    const target = findPlaybackTarget(step)
    if (!target) return false

    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true })
    }

    const options = {
      bubbles: true,
      cancelable: true,
      clientX: step.x,
      clientY: step.y,
    }
    target.dispatchEvent(new PointerEvent('pointerdown', options))
    target.dispatchEvent(new MouseEvent('mousedown', options))
    target.dispatchEvent(new PointerEvent('pointerup', options))
    target.dispatchEvent(new MouseEvent('mouseup', options))

    if (target instanceof HTMLElement) {
      target.click()
    }
    return true
  }

  if (step.type === 'keyboard') {
    const target = findPlaybackTarget(step) || document.activeElement || document.body
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true })
    }
    const options = {
      bubbles: true,
      cancelable: true,
      key: step.key,
      code: step.code,
      ctrlKey: step.ctrlKey,
      altKey: step.altKey,
      shiftKey: step.shiftKey,
      metaKey: step.metaKey,
    }
    target.dispatchEvent(new KeyboardEvent('keydown', options))
    applyKeyboardInput(target, step)
    target.dispatchEvent(new KeyboardEvent('keyup', options))
    return true
  }

  return false
}

function describeTarget(target: HTMLElement) {
  const text = target.textContent?.trim().replace(/\s+/g, ' ')
  if (text) return text.slice(0, 36)
  if (target.id) return `#${target.id}`
  if (target.getAttribute('aria-label')) return target.getAttribute('aria-label') || target.tagName.toLowerCase()
  return target.tagName.toLowerCase()
}

function findPlaybackTarget(step: RecordedStep) {
  if (step.selector) {
    const selectedTarget = document.querySelector(step.selector)
    if (selectedTarget) return selectedTarget
  }

  if (step.x !== undefined && step.y !== undefined) {
    return document.elementFromPoint(step.x, step.y)
  }

  return null
}

function getTargetSelector(target: HTMLElement) {
  if (!target || target === document.body) return 'body'
  if (target.id) return `#${CSS.escape(target.id)}`

  const path: string[] = []
  let element: HTMLElement | null = target

  while (element && element !== document.body && path.length < 5) {
    let selector = element.tagName.toLowerCase()

    const className = Array.from(element.classList)
      .filter((name) => !name.startsWith('vite-'))
      .slice(0, 2)
      .map((name) => `.${CSS.escape(name)}`)
      .join('')
    selector += className

    const parent: HTMLElement | null = element.parentElement
    if (parent) {
      const tagName = element.tagName
      const siblings = Array.from(parent.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.tagName === tagName,
      )
      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(element) + 1})`
      }
    }

    path.unshift(selector)
    element = parent
  }

  return path.join(' > ')
}

function applyKeyboardInput(target: Element, step: RecordedStep) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return
  }

  if (step.ctrlKey || step.altKey || step.metaKey || !step.key) return

  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? target.value.length
  let nextValue: string
  let nextCursor: number

  if (step.key.length === 1) {
    nextValue = `${target.value.slice(0, start)}${step.key}${target.value.slice(end)}`
    nextCursor = start + step.key.length
  } else if (step.key === 'Backspace') {
    const deleteFrom = start === end ? Math.max(0, start - 1) : start
    nextValue = `${target.value.slice(0, deleteFrom)}${target.value.slice(end)}`
    nextCursor = deleteFrom
  } else if (step.key === 'Enter' && target instanceof HTMLTextAreaElement) {
    nextValue = `${target.value.slice(0, start)}\n${target.value.slice(end)}`
    nextCursor = start + 1
  } else {
    return
  }

  target.value = nextValue
  target.setSelectionRange(nextCursor, nextCursor)
  target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
}

function formatShortcut(event: KeyboardEvent) {
  const keys = []
  if (event.metaKey) keys.push('Cmd')
  if (event.ctrlKey) keys.push('Ctrl')
  if (event.altKey) keys.push('Alt')
  if (event.shiftKey) keys.push('Shift')

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  if (!['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) {
    keys.push(key)
  }

  return keys.length ? keys.join('+') : key
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

export default App2

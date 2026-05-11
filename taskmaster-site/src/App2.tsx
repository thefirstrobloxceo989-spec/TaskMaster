import './App2.css'
import { useCallback, useEffect, useRef, useState } from 'react'

type RepeatMode = 'times' | 'seconds' | 'minutes'
type ActionStatus = 'idle' | 'running' | 'paused'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type RecordedStep = {
  id: number
  type: 'click' | 'keyboard'
  label: string
  delay: number
  x?: number
  y?: number
  key?: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
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
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)

  const lastRecordedAt = useRef(0)
  const stepId = useRef(1)
  const stopActionRequested = useRef(false)
  const actionPaused = useRef(false)

  const addLog = useCallback((message: string) => {
    setActivityLog((items) => [message, ...items].slice(0, 8))
  }, [])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      addLog('App install is available')
    }

    const handleInstalled = () => {
      setInstallPrompt(null)
      setStatusMessage('TaskMaster is installed as an app.')
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
        x: event.clientX,
        y: event.clientY,
      })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('.app2-controls')) return
      recordStep({
        type: 'keyboard',
        label: `press ${formatShortcut(event)}`,
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

  const runAction = async () => {
    const amount = Number(repeatValue)
    if (!recordedSteps.length) {
      setStatusMessage('Record at least one step before running an action.')
      return
    }
    if (!Number.isFinite(amount) || amount < 1) {
      setStatusMessage('Choose a repeat amount of 1 or more.')
      return
    }

    stopActionRequested.current = false
    actionPaused.current = false
    setActionStatus('running')
    setStatusMessage('Action is running.')
    addLog('Action started')

    const startedAt = Date.now()
    const runUntil =
      repeatMode === 'seconds'
        ? startedAt + amount * 1000
        : repeatMode === 'minutes'
          ? startedAt + amount * 60 * 1000
          : null

    let cycle = 0
    while (!stopActionRequested.current) {
      if (runUntil && Date.now() >= runUntil) break
      if (!runUntil && cycle >= amount) break

      cycle += 1
      addLog(`Action cycle ${cycle}`)

      for (const step of recordedSteps) {
        if (stopActionRequested.current) break
        while (actionPaused.current && !stopActionRequested.current) {
          await wait(120)
        }
        await wait(step.delay)
        playRecordedStep(step)
        addLog(`Played ${step.label}`)
      }
    }

    setActionStatus('idle')
    setStatusMessage(
      stopActionRequested.current
        ? 'Action stopped.'
        : `Action finished after ${cycle} cycle(s).`,
    )
    addLog('Action ended')
  }

  const stopAction = () => {
    if (actionStatus === 'idle') {
      setStatusMessage('No action is currently running.')
      return
    }
    stopActionRequested.current = true
    actionPaused.current = false
    setActionStatus('idle')
    addLog('Stop action requested')
  }

  const pauseAction = () => {
    if (actionStatus !== 'running') {
      setStatusMessage('Start an action before pausing it.')
      return
    }
    actionPaused.current = true
    setActionStatus('paused')
    setStatusMessage('Action paused.')
    addLog('Action paused')
  }

  const resumeAction = () => {
    if (actionStatus === 'running') {
      setStatusMessage('Action is already running.')
      return
    }
    if (actionStatus === 'idle') {
      runAction()
      return
    }
    actionPaused.current = false
    setActionStatus('running')
    setStatusMessage('Action resumed.')
    addLog('Action resumed')
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
        ? 'TaskMaster is installing as an app.'
        : 'App install was dismissed.',
    )
    addLog(`Install ${choice.outcome}`)
  }

  return (
    <main className="app2-shell">
      <header className="landing-copy">
        <h1>TaskMaster</h1>
        <p>
          An AI automation tool that will forever revolutionize the automation
          industry.
        </p>
      </header>
      <section className="glass-bar app2-controls" aria-label="Task controls">
        <div className="button-row" aria-label="Recording controls">
          <button type="button" className="glass-button" onClick={startRecording}>
            Record
          </button>
          <button type="button" className="glass-button" onClick={stopRecording}>
            Stop
          </button>
          <button type="button" className="glass-button" onClick={pauseRecording}>
            Pause
          </button>
          <button type="button" className="glass-button" onClick={resumeRecording}>
            Resume
          </button>
          <button type="button" className="glass-button" onClick={installApp}>
            Install App
          </button>
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
              Action:
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
          <button type="button" className="glass-button" onClick={stopAction}>
            Stop Action
          </button>
          <button type="button" className="glass-button" onClick={pauseAction}>
            Pause Action
          </button>
          <button type="button" className="glass-button" onClick={resumeAction}>
            Repeat Action
          </button>
        </div>
      </section>
      <section className="automation-panel" aria-label="Automation status">
        <div className="status-row">
          <span className={isRecording ? 'status-dot active' : 'status-dot'} />
          <p>{statusMessage}</p>
        </div>
        <p className="capture-note">
          Browser security limits this recorder to the current page. Desktop-wide
          recording needs a native app with input/accessibility permission.
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

function playRecordedStep(step: RecordedStep) {
  if (step.type === 'click' && step.x !== undefined && step.y !== undefined) {
    const target = document.elementFromPoint(step.x, step.y)
    if (!target) return
    const options = {
      bubbles: true,
      cancelable: true,
      clientX: step.x,
      clientY: step.y,
    }
    target.dispatchEvent(new MouseEvent('mousedown', options))
    target.dispatchEvent(new MouseEvent('mouseup', options))
    target.dispatchEvent(new MouseEvent('click', options))
    return
  }

  if (step.type === 'keyboard') {
    const target = document.activeElement || document.body
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
    target.dispatchEvent(new KeyboardEvent('keyup', options))
  }
}

function describeTarget(target: HTMLElement) {
  const text = target.textContent?.trim().replace(/\s+/g, ' ')
  if (text) return text.slice(0, 36)
  if (target.id) return `#${target.id}`
  if (target.getAttribute('aria-label')) return target.getAttribute('aria-label') || target.tagName.toLowerCase()
  return target.tagName.toLowerCase()
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

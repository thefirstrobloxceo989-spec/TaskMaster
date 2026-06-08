import './App2.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getCurrentRecordingApi,
  loadRecordingApi,
  pauseRecordingApi,
  resumeRecordingApi,
  startRecordingApi,
  stopRecordingApi,
  type DesktopRecordingEvent,
  type RecordingCurrent,
  type SavedRecording,
} from './api/recordings'

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
const CONFIGURED_API_BASE_URL = import.meta.env.VITE_TASKMASTER_API_BASE_URL || null

type DesktopInfo = {
  platform: string
  accessibilityTrusted: boolean | null
  apiBaseUrl?: string | null
}

type NativeStepResult = {
  ok: boolean
  message?: string
}

declare global {
  interface Window {
    taskmasterDesktop?: {
      getApiBaseUrl: () => Promise<string | null>
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
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(CONFIGURED_API_BASE_URL)
  const [desktopRecording, setDesktopRecording] = useState<RecordingCurrent>({
    id: null,
    status: 'idle',
    startedAt: null,
    eventCount: 0,
  })
  const [savedRecording, setSavedRecording] = useState<SavedRecording | null>(null)
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)

  const tabId = useRef(crypto.randomUUID())
  const channel = useRef<BroadcastChannel | null>(null)
  const linkedTabs = useRef(new Map<string, number>())
  const messageHandler = useRef<(message: TabMessage) => void>(() => {})
  const actionStatusRef = useRef<ActionStatus>('idle')
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

  const syncRecordingState = useCallback(async () => {
    if (!apiBaseUrl) return

    const recording = await getCurrentRecordingApi(apiBaseUrl)
    setDesktopRecording(recording)
    setIsRecording(recording.status !== 'idle')
    setIsRecordingPaused(recording.status === 'paused')
  }, [apiBaseUrl])

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
      setApiBaseUrl(info.apiBaseUrl || null)
      addLog('Desktop app mode enabled')
    })

    window.taskmasterDesktop?.getApiBaseUrl().then((baseUrl) => {
      if (!isMounted || !baseUrl) return
      setApiBaseUrl(baseUrl)
    })

    return () => {
      isMounted = false
    }
  }, [addLog])

  useEffect(() => {
    if (!apiBaseUrl) return

    const timeout = window.setTimeout(() => {
      void syncRecordingState().catch((error) => {
        setStatusMessage(error.message)
      })
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [apiBaseUrl, syncRecordingState])

  useEffect(() => {
    if (!apiBaseUrl || desktopRecording.status === 'idle') return

    const interval = window.setInterval(() => {
      void syncRecordingState().catch((error) => {
        setStatusMessage(error.message)
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [apiBaseUrl, desktopRecording.status, syncRecordingState])

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

  const startRecording = async () => {
    if (!apiBaseUrl) {
      setStatusMessage('Recording backend is not connected.')
      return
    }

    try {
      const recording = await startRecordingApi(apiBaseUrl)
      setDesktopRecording(recording)
      setSavedRecording(null)
      setRecordedSteps([])
      setIsRecording(recording.status !== 'idle')
      setIsRecordingPaused(recording.status === 'paused')
      setStatusMessage('Recording started by the backend.')
      addLog(`Recording started: ${recording.id}`)
    } catch (error) {
      setStatusMessage(getErrorMessage(error))
    }
  }

  const stopRecording = async () => {
    if (!apiBaseUrl) {
      setStatusMessage('Recording backend is not connected.')
      return
    }

    try {
      const result = await stopRecordingApi(apiBaseUrl)
      setSavedRecording(result)
      setDesktopRecording({
        id: null,
        status: 'idle',
        startedAt: null,
        eventCount: result.eventCount,
      })
      const savedSteps = await loadDesktopRecordingSteps(apiBaseUrl, result.id)
      setRecordedSteps(savedSteps)
      setIsRecording(false)
      setIsRecordingPaused(false)
      setStatusMessage(`Recording stopped and saved with ${savedSteps.length} runnable step(s).`)
      addLog(`Saved ${result.id}`)
    } catch (error) {
      setStatusMessage(getErrorMessage(error))
    }
  }

  const pauseRecording = async () => {
    if (!apiBaseUrl) {
      setStatusMessage('Recording backend is not connected.')
      return
    }

    try {
      const recording = await pauseRecordingApi(apiBaseUrl)
      setDesktopRecording(recording)
      setIsRecording(recording.status !== 'idle')
      setIsRecordingPaused(recording.status === 'paused')
      setStatusMessage('Recording paused by the backend.')
      addLog('Recording paused')
    } catch (error) {
      setStatusMessage(getErrorMessage(error))
    }
  }

  const resumeRecording = async () => {
    if (!apiBaseUrl) {
      setStatusMessage('Recording backend is not connected.')
      return
    }

    try {
      const recording = await resumeRecordingApi(apiBaseUrl)
      setDesktopRecording(recording)
      setIsRecording(recording.status !== 'idle')
      setIsRecordingPaused(recording.status === 'paused')
      setStatusMessage('Recording resumed by the backend.')
      addLog('Recording resumed')
    } catch (error) {
      setStatusMessage(getErrorMessage(error))
    }
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
    if (apiBaseUrl && isRecording) {
      setStatusMessage('Stop the desktop recording before clearing the current view.')
      return
    }
    broadcast({ type: 'clear' })
    applyClearRecording()
  }

  const applyClearRecording = () => {
    setRecordedSteps([])
    setSavedRecording(null)
    setDesktopRecording({
      id: null,
      status: 'idle',
      startedAt: null,
      eventCount: 0,
    })
    setIsRecording(false)
    setIsRecordingPaused(false)
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
        ? 'TaskMaster is installing as an app.'
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

    setStatusMessage('Enable TaskMaster in Accessibility, then restart the app if needed.')
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
  const hasRecordingBackend = Boolean(apiBaseUrl)
  const recordingEventCount = apiBaseUrl
    ? isRecording
      ? desktopRecording.eventCount
      : recordedSteps.length
    : recordedSteps.length
  const hasRecordingEvents = recordingEventCount > 0
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
        <h1>TaskMaster</h1>
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
            disabled={!hasRecordingBackend || isRecording}
          >
            Record
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={stopRecording}
            disabled={!hasRecordingBackend || !isRecording}
          >
            Stop
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={pauseRecording}
            disabled={!hasRecordingBackend || !isRecording || isRecordingPaused}
          >
            Pause
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={resumeRecording}
            disabled={!hasRecordingBackend || !isRecording || !isRecordingPaused}
          >
            Resume
          </button>
          <button
            type="button"
            className="glass-button"
            onClick={clearRecording}
            disabled={!hasRecordedSteps && !isRecording && !hasRecordingEvents}
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
            {hasRecordingEvents
              ? `${recordingEventCount} event${recordingEventCount === 1 ? '' : 's'} captured`
              : 'No events captured'}
          </span>
          <span>
            {linkedTabCount === 1
              ? '1 tab linked'
              : `${linkedTabCount} tabs linked`}
          </span>
          <span>{isDesktopApp ? 'Desktop app' : 'Web app'}</span>
          {!hasRecordingBackend && <span>Desktop install required</span>}
          {desktopInfo?.accessibilityTrusted === false && (
            <span>Accessibility needed</span>
          )}
        </div>
        <p className="capture-note">
          {apiBaseUrl
            ? `Desktop recording is controlled by ${apiBaseUrl} and saved locally as JSON.`
            : 'Desktop recording requires the TaskMaster desktop app. The web build is a static UI only.'}
          {savedRecording ? ` Last saved: ${savedRecording.id}.` : ''}
        </p>
        <div className="automation-grid">
          <div>
            <h2>Recorded steps</h2>
            <ol className="step-list">
              {apiBaseUrl ? (
                recordedSteps.length ? (
                  recordedSteps.map((step) => (
                    <li key={step.id}>
                      {step.label}
                      <span>{Math.round(step.delay / 100) / 10}s</span>
                    </li>
                  ))
                ) : (
                  <li>
                    {desktopRecording.id || savedRecording?.id || 'No active desktop recording'}
                    <span>{recordingEventCount}</span>
                  </li>
                )
              ) : recordedSteps.length ? (
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Recording request failed.'
}

async function loadDesktopRecordingSteps(apiBaseUrl: string, recordingId: string) {
  const recording = await loadRecordingApi(apiBaseUrl, recordingId)

  return recording.events.flatMap((event, index): RecordedStep[] => {
    const delay = Math.max(80, Number.isFinite(event.delay) ? event.delay : 0)

    if (event.type === 'mouseDown' && event.x !== null && event.y !== null) {
      return [
        {
          id: index + 1,
          type: 'click',
          label: `click screen ${Math.round(event.x)}, ${Math.round(event.y)}`,
          delay,
          screenX: event.x,
          screenY: event.y,
        },
      ]
    }

    if (event.type === 'keyDown' && event.keycode !== null) {
      const key = getKeyFromUiohookCode(event.keycode)
      if (!key) return []

      return [
        {
          id: index + 1,
          type: 'keyboard',
          label: `press ${formatRecordedShortcut(key, event)}`,
          delay,
          key,
          code: getDomCodeFromKey(key),
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
      ]
    }

    return []
  }).map((step, index) => ({ ...step, id: index + 1 }))
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

function formatRecordedShortcut(
  key: string,
  event: Pick<DesktopRecordingEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
) {
  const keys = []
  if (event.metaKey) keys.push('Cmd')
  if (event.ctrlKey) keys.push('Ctrl')
  if (event.altKey) keys.push('Alt')
  if (event.shiftKey) keys.push('Shift')
  keys.push(key.length === 1 ? key.toUpperCase() : key)
  return keys.join('+')
}

const UIOHOOK_KEY_NAMES: Record<number, string> = {
  1: 'Escape',
  2: '1',
  3: '2',
  4: '3',
  5: '4',
  6: '5',
  7: '6',
  8: '7',
  9: '8',
  10: '9',
  11: '0',
  12: '-',
  13: '=',
  14: 'Backspace',
  15: 'Tab',
  16: 'q',
  17: 'w',
  18: 'e',
  19: 'r',
  20: 't',
  21: 'y',
  22: 'u',
  23: 'i',
  24: 'o',
  25: 'p',
  26: '[',
  27: ']',
  28: 'Enter',
  30: 'a',
  31: 's',
  32: 'd',
  33: 'f',
  34: 'g',
  35: 'h',
  36: 'j',
  37: 'k',
  38: 'l',
  39: ';',
  40: "'",
  41: '`',
  43: '\\',
  44: 'z',
  45: 'x',
  46: 'c',
  47: 'v',
  48: 'b',
  49: 'n',
  50: 'm',
  51: ',',
  52: '.',
  53: '/',
  57: ' ',
  59: 'F1',
  60: 'F2',
  61: 'F3',
  62: 'F4',
  63: 'F5',
  64: 'F6',
  65: 'F7',
  66: 'F8',
  67: 'F9',
  68: 'F10',
  87: 'F11',
  88: 'F12',
  3655: 'Home',
  3657: 'PageUp',
  3663: 'End',
  3665: 'PageDown',
  3666: 'Insert',
  3667: 'Delete',
  57416: 'ArrowUp',
  57419: 'ArrowLeft',
  57421: 'ArrowRight',
  57424: 'ArrowDown',
}

function getKeyFromUiohookCode(keycode: number) {
  return UIOHOOK_KEY_NAMES[keycode] || null
}

function getDomCodeFromKey(key: string) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`

  const namedCodes: Record<string, string> = {
    ' ': 'Space',
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
  }
  return namedCodes[key] || key
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

export default App2

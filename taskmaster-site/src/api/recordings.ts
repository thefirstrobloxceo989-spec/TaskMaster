export type RecordingStatus = 'idle' | 'recording' | 'paused'

export type RecordingCurrent = {
  id: string | null
  status: RecordingStatus
  startedAt: string | null
  eventCount: number
}

export type SavedRecording = {
  id: string
  status: 'saved'
  eventCount: number
  path: string
}

export type DesktopRecordingEvent = {
  id: number
  type: 'mouseDown' | 'mouseUp' | 'keyDown' | 'keyUp' | 'wheel'
  delay: number
  x: number | null
  y: number | null
  keycode: number | null
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  appName: string | null
  windowTitle: string | null
}

export type DesktopRecordingFile = {
  id: string
  events: DesktopRecordingEvent[]
}

export function getCurrentRecordingApi(apiBaseUrl: string) {
  return requestRecordingApi<RecordingCurrent>(
    apiBaseUrl,
    '/api/recordings/current',
  )
}

export function startRecordingApi(apiBaseUrl: string) {
  return requestRecordingApi<RecordingCurrent>(
    apiBaseUrl,
    '/api/recordings/start',
    { method: 'POST' },
  )
}

export function stopRecordingApi(apiBaseUrl: string) {
  return requestRecordingApi<SavedRecording>(
    apiBaseUrl,
    '/api/recordings/stop',
    { method: 'POST' },
  )
}

export function pauseRecordingApi(apiBaseUrl: string) {
  return requestRecordingApi<RecordingCurrent>(
    apiBaseUrl,
    '/api/recordings/pause',
    { method: 'POST' },
  )
}

export function resumeRecordingApi(apiBaseUrl: string) {
  return requestRecordingApi<RecordingCurrent>(
    apiBaseUrl,
    '/api/recordings/resume',
    { method: 'POST' },
  )
}

export function loadRecordingApi(apiBaseUrl: string, recordingId: string) {
  return requestRecordingApi<DesktopRecordingFile>(
    apiBaseUrl,
    `/api/recordings/${encodeURIComponent(recordingId)}`,
  )
}

async function requestRecordingApi<T>(
  apiBaseUrl: string,
  endpoint: string,
  init?: RequestInit,
) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || `Recording API failed with ${response.status}.`)
  }

  return payload as T
}

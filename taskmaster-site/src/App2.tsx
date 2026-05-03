import './App2.css'
import { useState } from 'react'

const topButtons = [
  'Record',
  'Stop',
  'Pause',
  'Resume',
]

const bottomButtons = [
  'Stop Action',
  'Pause Action',
  'Repeat Action',
]

function App2() {
  const [showActionOptions, setShowActionOptions] = useState(false)
  const [repeatValue, setRepeatValue] = useState('3')
  const [repeatMode, setRepeatMode] = useState('times')

  return (
    <main className="app2-shell">
      <header className="landing-copy">
        <h1>TaskMaster</h1>
        <p>
          An AI automation tool that will forever revolutionize the automation
          industry.
        </p>
      </header>
      <section className="glass-bar" aria-label="Task controls">
        <div className="button-row" aria-label="Recording controls">
          {topButtons.map((label) => (
            <button key={label} type="button" className="glass-button">
              {label}
            </button>
          ))}
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
                  onChange={(event) => setRepeatMode(event.target.value)}
                >
                  <option value="times">times</option>
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                </select>
              </div>
            )}
          </div>
          {bottomButtons.map((label) => (
            <button key={label} type="button" className="glass-button">
              {label}
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App2

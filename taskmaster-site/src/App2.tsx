import './App2.css'

const buttons = [
  'Record',
  'Stop',
  'Pause',
  'Resume',
  'Action',
  'Stop Action',
  'Pause Action',
  'Repeat Action',
]

function App2() {
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
        {buttons.map((label) => (
          <button key={label} type="button" className="glass-button">
            {label}
          </button>
        ))}
      </section>
    </main>
  )
}

export default App2

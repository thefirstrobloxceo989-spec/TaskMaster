import React, { useState, useEffect } from 'react';

const TaskMaster = () => {
  const [status, setStatus] = useState<'idle' | 'recording' | 'paused' | 'repeating'>('idle');
  const [repeatValue, setRepeatValue] = useState('');

  // Keyboard Shortcut: Stop task completely
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'S') { // Shift + S to Emergency Stop
        setStatus('idle');
        console.log("Task Stopped via Shortcut");
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      {/* APP WINDOW */}
      <div style={{ width: '25vw', height: '12.5vh' }} 
           className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-4 flex flex-col justify-between text-white">
      
        
        <h1 className="text-xs font-bold tracking-widest uppercase opacity-50">TaskMaster</h1>

        <div className="flex items-center justify-between gap-2">
          {/* 1. Record / 4. Resume */}
          {status === 'idle' || status === 'paused' ? (
            <button onClick={() => setStatus('recording')} className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded-full text-xs font-semibold transition">
              {status === 'paused' ? '▶ Resume' : '● Record'}
            </button>
          ) : null}

          {/* 3. Pause */}
          {status === 'recording' && (
            <button onClick={() => setStatus('paused')} className="bg-yellow-500 hover:bg-yellow-600 px-3 py-1 rounded-full text-xs font-semibold transition">
              Ⅱ Pause
            </button>
          )}

          {/* 2. Stop & Save */}
          {(status === 'recording' || status === 'paused') && (
            <button onClick={() => setStatus('idle')} className="bg-gray-700 hover:bg-gray-800 px-3 py-1 rounded-full text-xs font-semibold transition">
              ■ Stop & Save
            </button>
          )}

          {/* 5. Repeat Box */}
          <div className="flex flex-col">
            <input 
              type="text" 
              placeholder="Repeats..."
              value={repeatValue}
              onChange={(e) => setRepeatValue(e.target.value)}
              className="bg-black/20 border border-white/10 rounded px-2 py-1 text-[10px] w-20 focus:outline-none focus:border-blue-400"
            />
          </div>

          {/* 6. Stop Repeating */}
          {status === 'repeating' ? (
            <button onClick={() => setStatus('idle')} className="bg-orange-600 px-3 py-1 rounded-full text-xs font-semibold">
              Stop Repeating
            </button>
          ) : (
            <button onClick={() => setStatus('repeating')} className="bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded-full text-xs font-semibold transition">
              Start
            </button>
          )}
        </div>

        <p className="text-[9px] opacity-40 text-center">Shortcut: Shift + S to kill task</p>
      </div>
    </div>
  );
};

export default TaskMaster;

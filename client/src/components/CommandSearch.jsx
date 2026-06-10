import { useState } from 'react';
import { Terminal, ChevronRight } from 'lucide-react';

export function CommandSearch({ onRunCommand }) {
  const [value, setValue] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!value.trim()) return;
    onRunCommand(value.trim());
  }

  return (
    <form className="command-search" onSubmit={submit}>
      <span className="command-search-prompt" aria-hidden="true">
        <Terminal size={14} />
        <span>NAVCOM</span>
        <ChevronRight size={14} />
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Try: "closest ship to Aurora" · Clear with "clear filter" or the Clear focus button'
      />
      <button type="submit" className="tool-btn command-search-run">
        <span className="tool-label">Execute</span>
      </button>
    </form>
  );
}

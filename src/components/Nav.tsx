import { useEffect, useState } from 'react';
import type { SimStore } from '../store';
import { tickClock } from '../engine';
import type { GridStatus, Section } from '../types';

const NAV_LINKS: { section: Section; label: string }[] = [
  { section: 'landscape', label: 'Overview' },
  { section: 'analytics', label: '24h Forecast' },
  { section: 'compare', label: 'Compare' },
  { section: 'how-it-works', label: 'How It Works' },
];

function formatClock(time: number): string {
  const h = Math.floor(time);
  const m = Math.floor((time % 1) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function Clock({ store }: { store: SimStore }) {
  const [text, setText] = useState(() => formatClock(store.getSnapshot().time));

  useEffect(() => {
    const id = setInterval(() => {
      const next = tickClock(store.getSnapshot());
      store.set(next, { silent: true });
      setText(formatClock(next.time));
    }, 100);
    return () => clearInterval(id);
  }, [store]);

  return <div className="nav-time">{text}</div>;
}

export function Nav({
  store,
  section,
  gridStatus,
  onNavigate,
}: {
  store: SimStore;
  section: Section;
  gridStatus: GridStatus;
  onNavigate: (section: Section) => void;
}) {
  return (
    <nav id="main-nav">
      <div className="nav-left">
        <div className="nav-brand">ENERFLUX</div>
        <div className="nav-tag">SIMULATED MICROGRID</div>
      </div>
      <div className="nav-center">
        {NAV_LINKS.map(link => (
          <button
            key={link.section}
            className={'nav-link' + (section === link.section ? ' active' : '')}
            onClick={() => onNavigate(link.section)}
          >
            {link.label}
          </button>
        ))}
      </div>
      <div className="nav-right">
        <div className="nav-status">
          <span className={'status-dot ' + (gridStatus === 'STABLE' ? 'green' : 'red')} /> Grid Online
        </div>
        <Clock store={store} />
      </div>
    </nav>
  );
}

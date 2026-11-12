import { useState } from 'react';

const storageKey = (id) => `section:${id}`;

function readOpen(id, defaultOpen) {
  try {
    const v = localStorage.getItem(storageKey(id));
    return v == null ? defaultOpen : v === '1';
  } catch {
    return defaultOpen;
  }
}

/** A panel with a clickable header that collapses its body. Open/closed is remembered per `id`. */
export default function Section({ id, title, actions, children, className = '', defaultOpen = true }) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));

  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(storageKey(id), o ? '0' : '1');
      } catch {
        /* not persisted */
      }
      return !o;
    });

  return (
    <section className={`panel collapsible ${open ? 'open' : 'closed'} ${className}`}>
      <div className="section-head">
        <button className="section-toggle" onClick={toggle} aria-expanded={open} aria-controls={`section-${id}`}>
          <span className="chevron" aria-hidden="true">▸</span>
          <h2>{title}</h2>
        </button>
        {actions && open && <div className="btn-row">{actions}</div>}
      </div>
      {open && (
        <div id={`section-${id}`} className="section-body">
          {children}
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';

interface Props {
  message: string;
  duration?: number;
  onUndo: () => void;
  onDismiss: () => void;
}

/**
 * 5-second toast bar with Undo button. Auto-dismisses after duration.
 * Shown after deleting an expense — Undo restores it.
 */
export function UndoToast({ message, duration = 5000, onUndo, onDismiss }: Props) {
  const [remaining, setRemaining] = useState(100);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / duration) * 100);
      setRemaining(pct);
      if (pct <= 0) {
        clearInterval(interval);
        onDismiss();
      }
    }, 50);
    return () => clearInterval(interval);
  }, [duration, onDismiss]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 20px',
        background: '#1a1a2e',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        fontSize: '0.85rem',
        color: 'rgba(255,255,255,0.8)',
        maxWidth: 'calc(100vw - 32px)',
        animation: 'slideUp 0.3s ease',
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={onUndo}
        style={{
          background: 'rgba(16,185,129,0.15)',
          color: '#10b981',
          border: 'none',
          borderRadius: 8,
          padding: '6px 14px',
          fontWeight: 700,
          fontSize: '0.8rem',
          cursor: 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >
        Undo
      </button>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 3,
          width: `${remaining}%`,
          background: '#10b981',
          borderRadius: '0 0 12px 12px',
          transition: 'width 50ms linear',
        }}
      />
    </div>
  );
}

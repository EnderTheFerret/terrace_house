// Small UI building blocks in the pixel style.
import { useEffect, type ReactNode } from 'react';
import { useGame } from '../store';

export function Panel({ children, className = '', soft = false, title }: { children: ReactNode; className?: string; soft?: boolean; title?: string }) {
  return (
    <section className={`${soft ? 'px-panel-soft' : 'px-panel'} p-3 ${className}`} aria-label={title}>
      {title && <h2 className="caption mb-2 text-sm">{title}</h2>}
      {children}
    </section>
  );
}

export function Btn({ children, onClick, primary, disabled, className = '', title, autoFocus }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; className?: string; title?: string; autoFocus?: boolean }) {
  // without onClick it submits its form (e.g. the phone's message box)
  return (
    <button type={onClick ? 'button' : 'submit'} className={`px-btn ${primary ? 'px-btn-primary' : ''} ${className}`} onClick={onClick} disabled={disabled} title={title} autoFocus={autoFocus}>
      {children}
    </button>
  );
}

export function Meter({ label, value, max = 100, color = 'var(--color-rose)' }: { label: string; value: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="text-xs">
      <div className="flex justify-between caption">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="h-2 bg-white" style={{ boxShadow: '0 0 0 1px var(--color-ink)' }} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
        <div className="h-2" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function Tag({ kind }: { kind: string }) {
  const style: Record<string, string> = { self: '#c9b4ef', witnessed: '#8fd3b8', told: '#f6d48f', rumor: '#f7b98a', unknown: '#ddd' };
  const sym: Record<string, string> = { self: '◆', witnessed: '●', told: '◐', rumor: '○', unknown: '?' };
  return (
    <span className="ml-1 inline-block px-1 text-[0.7rem] lowercase" style={{ background: style[kind] ?? '#eee', boxShadow: '0 0 0 1px var(--color-ink)' }}>
      {sym[kind] ?? ''} {kind}
    </span>
  );
}

export function Modal({ children, onClose, title }: { children: ReactNode; onClose?: () => void; title: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(58_46_63/0.35)] p-4" role="dialog" aria-modal aria-label={title}>
      <div className="px-panel slide-up max-h-[90vh] w-full max-w-xl overflow-auto p-5 scroll-thin">
        <h2 className="mb-3 text-lg lowercase">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function HealthBadge() {
  const h = useGame((s) => s.health);
  if (!h) return <span className="caption text-xs">server offline</span>;
  return (
    <span className="flex gap-2 text-[0.7rem] lowercase">
      <span className="px-1" title={`Planning and structured results: ${h.model} (${h.llm})`} style={{ background: h.linesLlm === 'ok' ? '#d8f0e4' : '#f8d8d0', boxShadow: '0 0 0 1px var(--color-ink)' }}>
        {h.mode === 'mock' ? 'dialogue: templates' : h.linesLlm === 'ok' ? `dialogue: ${h.linesModel}` : 'dialogue offline · templates'}
      </span>
      {h.mode !== 'mock' && h.model !== h.linesModel && <span className="caption">planning: {h.model}</span>}
      <span className="px-1" style={{ background: h.imagesOffline ? '#f8e6c8' : '#d8f0e4', boxShadow: '0 0 0 1px var(--color-ink)' }}>
        {h.imagesOffline ? 'images offline' : 'images: comfyui'}
      </span>
    </span>
  );
}

export function ErrorToast() {
  const { error, clearError } = useGame();
  if (!error) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 px-panel px-4 py-2 text-sm" role="alert">
      {error}{' '}
      <button className="ml-3 underline" onClick={clearError}>
        ok
      </button>
    </div>
  );
}

export const INTENT_LABEL: Record<string, string> = {
  honest: 'be honest', deflect: 'deflect', flirt: 'flirt', support: 'support them', joke: 'make a joke', tease: 'tease',
  apologize: 'apologize', confront: 'confront', confess: 'confess', decline: 'gently decline', listen: 'just listen',
};

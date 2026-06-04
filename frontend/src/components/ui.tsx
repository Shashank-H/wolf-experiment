import type React from 'react';

export function Card({ title, marker = '[+]', children, className = '' }: React.PropsWithChildren<{ title?: string; marker?: string; className?: string }>) {
  return (
    <section className={`card ${className}`}>
      {title && <h2><span>{marker}</span> {title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function EmptyState({ children }: React.PropsWithChildren) {
  return <div className="empty">[-] {children}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  return <p className="danger">[x] {error instanceof Error ? error.message : 'Request failed'}</p>;
}

export function SkeletonRows() {
  return <div className="skeleton"><span /><span /><span /></div>;
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes('cancel') || normalized.includes('reject') ? 'red' : normalized.includes('open') || normalized.includes('submitted') ? 'blue' : 'green';
  return <span className={`badge ${tone}`}>[{status.replaceAll('_', ' ')}]</span>;
}

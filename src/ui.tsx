import React from 'react';
import type { User } from './types';

export function Avatar({ user, size = 32 }: { user: User; size?: number }) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: user.color, fontSize: size * 0.52 }}
      aria-hidden
    >
      <span>{user.emoji}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'seg-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  emoji,
  title,
  hint,
}: {
  emoji: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}

export function MonthNav({
  month,
  onChange,
}: {
  month: Date;
  onChange: (d: Date) => void;
}) {
  const label = month.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  return (
    <div className="month-nav">
      <button
        aria-label="Previous month"
        onClick={() => onChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
      >
        ‹
      </button>
      <span>{label}</span>
      <button
        aria-label="Next month"
        onClick={() => onChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
      >
        ›
      </button>
    </div>
  );
}

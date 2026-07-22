import React from 'react';
import { useStore } from './store';

// Tiny, safe markdown renderer. Builds React elements directly (never
// innerHTML), so message text can't inject markup. Supports:
// **bold**, *italic*, `code`, - bullets, [ ] / [x] task lists,
// [label](url), bare URLs, and @mentions.

// A checklist line: "- [ ] item" or "- [x] item".
const TASK_RE = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/;

// Flip the Nth task checkbox in a markdown string (used to persist toggles).
export function toggleTaskInText(text: string, taskIndex: number): string {
  let count = -1;
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(TASK_RE);
      if (!m) return line;
      count += 1;
      if (count !== taskIndex) return line;
      const checked = m[2].toLowerCase() === 'x';
      return m[1] + (checked ? ' ' : 'x') + m[3] + m[4];
    })
    .join('\n');
}

const INLINE =
  /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"']+|@[A-Za-z0-9_]+)/g;

function renderInline(
  text: string,
  keyBase: string,
  mentionNames: Set<string>
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('*')) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('@')) {
      if (mentionNames.has(tok.slice(1).toLowerCase())) {
        out.push(
          <span key={key} className="mention">
            {tok}
          </span>
        );
      } else {
        out.push(tok);
      }
    } else if (tok.startsWith('[')) {
      const mm = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (mm) {
        out.push(
          <a key={key} href={mm[2]} target="_blank" rel="noreferrer">
            {mm[1]}
          </a>
        );
      } else {
        out.push(tok);
      }
    } else {
      out.push(
        <a key={key} href={tok} target="_blank" rel="noreferrer">
          {tok}
        </a>
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({
  text,
  onToggleTask,
}: {
  text: string;
  // When provided, task checkboxes become tappable; the callback gets the
  // task's index (0-based across the whole text).
  onToggleTask?: (taskIndex: number) => void;
}) {
  const { state } = useStore();
  const mentionNames = React.useMemo(
    () =>
      new Set([
        ...state.users.map((u) => u.name.toLowerCase()),
        'team',
        'everyone',
        'all',
      ]),
    [state.users]
  );
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  let taskIndex = 0;
  const flush = (key: string) => {
    if (bullets.length) {
      blocks.push(
        <ul key={key} className="md-list">
          {bullets}
        </ul>
      );
      bullets = [];
    }
  };
  lines.forEach((line, i) => {
    const task = line.match(TASK_RE);
    if (task) {
      const checked = task[2].toLowerCase() === 'x';
      const idx = taskIndex++;
      const box = checked ? '✓' : '';
      bullets.push(
        <li key={`li${i}`} className={'task-item' + (checked ? ' task-done' : '')}>
          {onToggleTask ? (
            <button
              type="button"
              className={'task-check' + (checked ? ' task-on' : '')}
              onClick={() => onToggleTask(idx)}
              aria-label={checked ? 'Uncheck' : 'Check off'}
            >
              {box}
            </button>
          ) : (
            <span className={'task-check' + (checked ? ' task-on' : '')}>{box}</span>
          )}
          <span className="task-text">{renderInline(task[4], `t${i}`, mentionNames)}</span>
        </li>
      );
      return;
    }
    const m = line.match(/^\s*[-*]\s+(.*)/);
    if (m) {
      bullets.push(
        <li key={`li${i}`}>{renderInline(m[1], `l${i}`, mentionNames)}</li>
      );
    } else {
      flush(`ul${i}`);
      if (line.trim())
        blocks.push(
          <p key={`p${i}`}>{renderInline(line, `p${i}`, mentionNames)}</p>
        );
    }
  });
  flush('ul-end');
  return <div className="md">{blocks}</div>;
}

import React, { useEffect, useState } from 'react';
import { useStore, unreadInboxCount, accentForEmoji } from './store';
import { Onboarding } from './views/Onboarding';
import { Home } from './views/Home';
import { ChannelView } from './views/Channel';
import { Hours } from './views/Hours';
import { Settings } from './views/Settings';
import { Mentions } from './views/Mentions';

type Tab = 'home' | 'mentions' | 'hours' | 'settings';

export default function App() {
  const { state, me } = useStore();
  // Retint the whole app to the current user's profile icon.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentForEmoji(me?.emoji ?? '☕️'));
  }, [me?.emoji]);
  if (!state.onboarded) return <Onboarding />;
  return <Shell />;
}

type OpenTarget = {
  id: string;
  view?: 'board' | 'notes' | 'chat';
  noteId?: string;
};

function Shell() {
  const [tab, setTab] = useState<Tab>('home');
  const [open, setOpen] = useState<OpenTarget | null>(null);

  return (
    <div className="app">
      <div className="app-body">
        {tab === 'home' && <Home onOpen={(t) => setOpen(t)} />}
        {tab === 'mentions' && (
          <Mentions onOpen={(id) => setOpen({ id, view: 'chat' })} />
        )}
        {tab === 'hours' && <Hours />}
        {tab === 'settings' && <Settings />}
      </div>
      <TabBar
        tab={tab}
        onTab={(t) => {
          setTab(t);
          setOpen(null); // dismiss any open channel when switching tabs
        }}
      />
      {open && (
        <ChannelView
          key={open.id + (open.view ?? '') + (open.noteId ?? '')}
          channelId={open.id}
          initialView={open.view}
          initialNoteId={open.noteId}
          onBack={() => setOpen(null)}
          onOpen={(id, view) => setOpen({ id, view })}
        />
      )}
    </div>
  );
}

function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { state, me } = useStore();
  const unread = unreadInboxCount(state, me.id);

  const items: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'home', label: 'Channels', icon: <ChatIcon /> },
    { id: 'mentions', label: 'Mentions', icon: <AtIcon />, badge: unread },
    { id: 'hours', label: 'Hours', icon: <ClockIcon /> },
    { id: 'settings', label: 'Settings', icon: <GearIcon /> },
  ];
  return (
    <nav className="tabbar">
      {items.map((it) => (
        <button
          key={it.id}
          className={'tab' + (tab === it.id ? ' tab-on' : '')}
          onClick={() => onTab(it.id)}
        >
          <span className="tab-icon">
            {it.icon}
            {it.badge ? (
              <span className="tab-badge">{it.badge > 9 ? '9+' : it.badge}</span>
            ) : null}
          </span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

function AtIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        d="M16 8.5a4 4 0 1 0 .9 4.7c.6 1 1.6 1.3 2.4.8 1.6-1 2.1-4 .9-6.6A8.2 8.2 0 1 0 15 20.4"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26">
      <path
        fill="currentColor"
        d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9.6L6 20.8A1 1 0 0 1 4.4 20V17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M12 7v5l3.2 2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26">
      <path
        fill="currentColor"
        d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5a.7.7 0 0 0 .2-.9l-1.9-3.2a.7.7 0 0 0-.9-.3l-2.3 1a7.6 7.6 0 0 0-1.7-1l-.3-2.5a.7.7 0 0 0-.7-.6h-3.6a.7.7 0 0 0-.7.6l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.3-1a.7.7 0 0 0-.9.3L2.4 8.6a.7.7 0 0 0 .2.9l2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5a.7.7 0 0 0-.2.9l1.9 3.2c.2.3.6.4.9.3l2.3-1c.5.4 1.1.8 1.7 1l.3 2.5c0 .4.4.6.7.6h3.6c.4 0 .7-.3.7-.6l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.3 1c.3.1.7 0 .9-.3l1.9-3.2a.7.7 0 0 0-.2-.9l-2-1.5zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
      />
    </svg>
  );
}

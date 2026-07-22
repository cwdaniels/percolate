import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { supabase } from '../lib/supabase';
import { Avatar } from '../ui';
import { InstallHelp, NotificationSetup } from './Onboarding';

const EMOJI_CHOICES = ['☕️', '🌱', '🔥', '🌻', '🦊', '🍩', '🎨', '🚴', '⭐️', '🫘'];

export function Settings() {
  const { state, me, updateProfile, setRole } = useStore();
  const { user, signOut } = useAuth();
  const [name, setName] = useState(me.name);
  const [showInstall, setShowInstall] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Owners can read their team's invite code (RLS: owner-only).
  useEffect(() => {
    if (me.role !== 'admin') return;
    supabase
      .from('team_invites')
      .select('code')
      .eq('team_id', state.currentTeamId)
      .maybeSingle()
      .then(({ data }) => setInvite(data?.code ?? null));
  }, [me.role, state.currentTeamId]);

  const copyInvite = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="screen">
      <header className="large-header">
        <h1>⚙️ Settings</h1>
      </header>
      <div className="screen-pad">
        <div className="card">
          <h3>Your profile</h3>
          <div className="profile-row">
            <Avatar user={me} size={48} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && updateProfile(name.trim(), me.emoji)}
            />
          </div>
          <div className="emoji-pick">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                className={'emoji-opt' + (e === me.emoji ? ' picked' : '')}
                onClick={() => updateProfile(me.name, e)}
              >
                {e}
              </button>
            ))}
          </div>
          <p className="hint">
            Signed in as {user?.email} · {me.role === 'admin' ? 'Owner 👑' : 'Staff'}
          </p>
        </div>

        {me.role === 'admin' && (
          <div className="card">
            <h3>Invite your team</h3>
            <p className="hint">
              Share this code. Teammates open Percolate, sign in with their own
              email, then enter it to join {state.teams.find((t) => t.id === state.currentTeamId)?.name ?? 'your team'}.
            </p>
            <div className="invite-row">
              <span className="invite-code">{invite ?? '…'}</span>
              <button className="btn primary small" onClick={copyInvite} disabled={!invite}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {me.role === 'admin' && (
          <div className="card">
            <h3>Team &amp; roles</h3>
            <p className="hint">
              Owners see Payroll and can manage channels. Tap a role to change it.
            </p>
            {state.users.map((u) => (
              <div key={u.id} className="member-row">
                <Avatar user={u} size={32} />
                <span className="member-name">
                  {u.name}
                  {u.id === me.id && <span className="member-you"> (you)</span>}
                </span>
                {u.id === me.id ? (
                  <span className="role-chip role-fixed">Owner 👑</span>
                ) : (
                  <button
                    className={'role-chip' + (u.role === 'admin' ? ' chip-on' : '')}
                    onClick={() => setRole(u.id, u.role === 'admin' ? 'staff' : 'admin')}
                  >
                    {u.role === 'admin' ? 'Owner 👑' : 'Staff'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <h3>Notifications</h3>
          <NotificationSetup />
          <p className="hint">
            Turning this on lets your browser show alerts. Team-wide push (pinging
            the whole crew on a mention) is a later step.
          </p>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Install on your device</h3>
            <button className="link" onClick={() => setShowInstall(!showInstall)}>
              {showInstall ? 'Hide' : 'Show'}
            </button>
          </div>
          {showInstall && <InstallHelp />}
        </div>

        <div className="card">
          <button className="btn ghost danger" onClick={() => signOut()}>
            Sign out
          </button>
        </div>

        <p className="footnote">
          Percolate v0.1 — brewed with care for Fireweed Coffee Co ☕️
        </p>
      </div>
    </div>
  );
}

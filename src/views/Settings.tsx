import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { supabase } from '../lib/supabase';
import { Avatar } from '../ui';
import { InstallHelp, NotificationSetup } from './Onboarding';
import { FocusModeSettings, EventNotifications, DataRetention } from './FocusMode';

const EMOJI_CHOICES = ['☕️', '🌱', '🔥', '🌻', '🦊', '🍩', '🎨', '🚴', '⭐️', '🫘'];

// Which day of the month a pay period opens. Only the two cycles anyone
// has actually asked for — an arbitrary day picker would be a lot of rope
// for no benefit, and the column accepts 1–28 if that ever changes.
const PAY_CYCLES = [
  { day: 1, label: 'Calendar months', blurb: 'The 1st through the end of the month.' },
  { day: 16, label: '16th to the 15th', blurb: 'A period closes on the 15th and the next opens on the 16th.' },
];

function PayCycle() {
  const { state, setPayPeriodStartDay } = useStore();
  const team = state.teams.find((t) => t.id === state.currentTeamId);
  const current = team?.payPeriodStartDay ?? 1;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async (day: number) => {
    if (day === current) return;
    setBusy(true);
    setErr('');
    const res = await setPayPeriodStartDay(day);
    setBusy(false);
    if (res.error) setErr(res.error);
  };

  return (
    <div className="card">
      <h3>Pay period</h3>
      <p className="hint">
        Sets the window Hours and Payroll total up. Periods you've already
        settled keep the dates they were paid on — this only affects how new
        ones are worked out.
      </p>
      {PAY_CYCLES.map((c) => (
        <label key={c.day} className="notify-row">
          <input
            type="radio"
            name="pay-cycle"
            checked={current === c.day}
            disabled={busy}
            onChange={() => pick(c.day)}
          />
          <span>
            <strong>{c.label}</strong>
            <span className="hint">{c.blurb}</span>
          </span>
        </label>
      ))}
      {err && <p className="hint error-hint">{err}</p>}
    </div>
  );
}

export function Settings() {
  const { state, me, updateProfile, setRole, setTeamEmoji } = useStore();
  const { user, signOut } = useAuth();
  const team = state.teams.find((t) => t.id === state.currentTeamId);
  const [name, setName] = useState(me.name);
  const [showInstall, setShowInstall] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [teamEmojiInput, setTeamEmojiInput] = useState(team?.emoji ?? '☕️');

  useEffect(() => {
    setTeamEmojiInput(team?.emoji ?? '☕️');
  }, [team?.emoji]);

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
            <h3>Team icon</h3>
            <p className="hint">Shown next to {team?.name ?? 'your team'} everywhere in the app.</p>
            <div className="team-emoji-row">
              <span className="team-emoji-current">{team?.emoji ?? '☕️'}</span>
              <input
                className="team-emoji-input"
                value={teamEmojiInput}
                onChange={(e) => setTeamEmojiInput(e.target.value)}
                onBlur={() => {
                  const v = teamEmojiInput.trim();
                  if (v) setTeamEmoji(v);
                  else setTeamEmojiInput(team?.emoji ?? '☕️');
                }}
                placeholder="Type or paste any emoji"
                maxLength={8}
              />
            </div>
            <div className="emoji-pick">
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  className={'emoji-opt' + (e === team?.emoji ? ' picked' : '')}
                  onClick={() => {
                    setTeamEmoji(e);
                    setTeamEmojiInput(e);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {me.role === 'admin' && <PayCycle />}

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
        </div>

        <EventNotifications />

        <FocusModeSettings />

        <DataRetention />

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

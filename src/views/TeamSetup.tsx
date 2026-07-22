import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';
import { accentForEmoji } from '../store';

const EMOJI_CHOICES = ['☕️', '🌱', '🔥', '🌻', '🦊', '🍩', '🎨', '🚴', '⭐️', '🫘'];

export type MyTeam = { teamId: string; role: 'owner' | 'staff'; name: string; emoji: string };

async function fetchMyTeams(userId: string): Promise<MyTeam[]> {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, teams ( name, emoji )')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    // The embedded `teams` comes back as an object for a to-one FK, but be
    // defensive in case it arrives as a single-element array.
    const t = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    return {
      teamId: row.team_id,
      role: row.role,
      name: t?.name ?? 'Team',
      emoji: t?.emoji ?? '☕️',
    };
  });
}

// Gates entry on having at least one real team membership. New sign-ins
// land in create-or-join; everyone else passes their first team through.
export function TeamGate({ children }: { children: (team: MyTeam) => React.ReactNode }) {
  const { user } = useAuth();
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const [error, setError] = useState('');

  const reload = () => {
    if (!user) return;
    fetchMyTeams(user.id)
      .then(setTeams)
      .catch((e) => setError(e.message ?? String(e)));
  };

  useEffect(reload, [user?.id]);

  if (error) {
    return (
      <div className="onboard">
        <div className="slide">
          <div className="onboard-hero">⚠️</div>
          <h1>Something went sideways</h1>
          <p className="sub">{error}</p>
          <button
            className="btn ghost"
            onClick={() => {
              setError('');
              reload();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (teams === null) {
    return (
      <div className="onboard">
        <div className="slide">
          <div className="onboard-hero">☕️</div>
          <p className="sub">Loading your teams…</p>
        </div>
      </div>
    );
  }

  if (teams.length === 0) {
    return <CreateOrJoinTeam onReady={reload} />;
  }

  return <>{children(teams[0])}</>;
}

function CreateOrJoinTeam({ onReady }: { onReady: () => void }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('☕️');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Live-preview the app accent as you pick your icon (as Settings does).
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentForEmoji(emoji));
  }, [emoji]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !user) return;
    setBusy(true);
    setError('');
    const { error } = await supabase
      .from('teams')
      .insert({ name: name.trim(), emoji, created_by: user.id });
    if (!error) {
      // Carry the icon you chose into your own look, so the color sticks.
      await supabase
        .from('profiles')
        .update({ emoji, color: accentForEmoji(emoji) })
        .eq('id', user.id);
    }
    setBusy(false);
    if (error) setError(error.message);
    else onReady();
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.rpc('join_team', { invite_code: code.trim() });
    setBusy(false);
    if (error) setError(error.message);
    else onReady();
  };

  return (
    <div className="onboard">
      <div className="slide">
        <div className="onboard-hero">☕️</div>
        <h1>{mode === 'create' ? 'Start your team' : 'Join a team'}</h1>
        <p className="sub">
          {mode === 'create'
            ? 'This becomes your team’s home — general chat and everything else is created for you automatically.'
            : 'Got an invite code from your team’s owner? Enter it below.'}
        </p>

        {mode === 'create' ? (
          <form onSubmit={create}>
            <label className="field-label">Team name</label>
            <input
              className="big-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fireweed Coffee Co"
              autoFocus
            />
            <div className="emoji-pick" style={{ marginTop: 10 }}>
              {EMOJI_CHOICES.map((e) => (
                <button
                  type="button"
                  key={e}
                  className={'emoji-opt' + (e === emoji ? ' picked' : '')}
                  onClick={() => setEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
            {error && <p className="hint error-hint">{error}</p>}
            <button
              className="btn primary big"
              type="submit"
              disabled={busy || !name.trim()}
              style={{ marginTop: 16 }}
            >
              {busy ? 'Creating…' : 'Create team →'}
            </button>
          </form>
        ) : (
          <form onSubmit={join}>
            <label className="field-label">Invite code</label>
            <input
              className="big-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="a1b2c3d4e5f6"
              autoFocus
            />
            {error && <p className="hint error-hint">{error}</p>}
            <button
              className="btn primary big"
              type="submit"
              disabled={busy || !code.trim()}
              style={{ marginTop: 16 }}
            >
              {busy ? 'Joining…' : 'Join team →'}
            </button>
          </form>
        )}

        <button
          className="link"
          style={{ marginTop: 18 }}
          onClick={() => {
            setMode(mode === 'create' ? 'join' : 'create');
            setError('');
          }}
        >
          {mode === 'create' ? 'Have an invite code instead?' : '‹ Back to creating a team'}
        </button>
      </div>
    </div>
  );
}

export function TeamReady({ team }: { team: MyTeam }) {
  const { user, signOut } = useAuth();
  const [invite, setInvite] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('☕️');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('name, emoji')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setName(data.name);
          setEmoji(data.emoji);
        }
      });
  }, [user]);

  useEffect(() => {
    if (team.role !== 'owner') return;
    supabase
      .from('team_invites')
      .select('code')
      .eq('team_id', team.teamId)
      .maybeSingle()
      .then(({ data }) => setInvite(data?.code ?? null));
  }, [team.teamId, team.role]);

  const saveProfile = async () => {
    if (!user) return;
    // Upsert (not update) so a first save can't silently no-op if the
    // profile row somehow isn't there yet.
    await supabase
      .from('profiles')
      .upsert({ id: user.id, name: name.trim(), emoji });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="onboard">
      <div className="slide">
        <div className="onboard-hero">{team.emoji}</div>
        <h1>{team.name} is live</h1>
        <p className="sub">
          Signed in as <strong>{user?.email}</strong> ·{' '}
          {team.role === 'owner' ? 'Owner 👑' : 'Staff'}. The real backend is connected
          — chat, boards, and everything else move over next.
        </p>

        <div className="card" style={{ textAlign: 'left', marginTop: 8 }}>
          <h3>Your profile</h3>
          <input
            className="big-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
          <div className="emoji-pick" style={{ marginTop: 10 }}>
            {EMOJI_CHOICES.map((e) => (
              <button
                type="button"
                key={e}
                className={'emoji-opt' + (e === emoji ? ' picked' : '')}
                onClick={() => setEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
          <button className="btn primary" onClick={saveProfile} style={{ marginTop: 12 }}>
            {saved ? 'Saved ✓' : 'Save profile'}
          </button>
        </div>

        {team.role === 'owner' && (
          <div className="card" style={{ textAlign: 'left' }}>
            <h3>Invite your team</h3>
            <p className="hint">
              Share this code — teammates sign in with their own email, then enter
              this to join.
            </p>
            <p
              className="big-input"
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 19, textAlign: 'center' }}
            >
              {invite ?? '…'}
            </p>
          </div>
        )}

        <button className="btn ghost" onClick={() => signOut()} style={{ marginTop: 10 }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

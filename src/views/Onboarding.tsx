import React, { useEffect, useState } from 'react';
import { useStore, accentForEmoji } from '../store';
import { Segmented } from '../ui';
import { useAuth } from '../auth';
import { pushSupported, getPushSubscription, enablePush, disablePush } from '../lib/push';

const EMOJI_CHOICES = ['☕️', '🌱', '🔥', '🌻', '🦊', '🍩', '🎨', '🚴', '⭐️', '🫘'];

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari exposes navigator.standalone when launched from Home Screen
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function InstallHelp() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  if (isStandalone()) {
    return <p className="hint">You’re already running from the Home Screen — nice ✨</p>;
  }
  const steps: Record<Platform, string[]> = {
    ios: [
      'Open this page in Safari (it won’t work from other apps’ browsers)',
      'Tap the Share button — the square with the arrow, bottom of the screen',
      'Scroll down and tap “Add to Home Screen”',
      'Tap “Add” — Percolate now lives next to your other apps ☕️',
    ],
    android: [
      'Open this page in Chrome',
      'Tap the ⋮ menu in the top-right corner',
      'Tap “Add to Home screen” (or “Install app”)',
      'Confirm — done! ☕️',
    ],
    desktop: [
      'Look for the install icon (a little screen with an arrow) in the address bar',
      'Click it and choose “Install”',
      'Percolate opens in its own window, like a real desktop app ☕️',
    ],
  };
  return (
    <div className="install-help">
      <Segmented
        options={[
          { value: 'ios', label: 'iPhone/iPad' },
          { value: 'android', label: 'Android' },
          { value: 'desktop', label: 'Computer' },
        ]}
        value={platform}
        onChange={setPlatform}
      />
      <ol className="steps">
        {steps[platform].map((s, i) => (
          <li key={i}>
            <span className="step-num">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function NotificationSetup() {
  const { user } = useAuth();
  const supported = pushSupported();
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supported) return;
    getPushSubscription().then((s) => setSubscribed(!!s));
  }, [supported]);

  const enable = async () => {
    if (!user) return;
    setBusy(true);
    setError('');
    const res = await enablePush(user.id);
    setBusy(false);
    setPerm(Notification.permission);
    if (res.ok) setSubscribed(true);
    else setError(res.error ?? 'Something went wrong.');
  };

  const disable = async () => {
    if (!user) return;
    setBusy(true);
    await disablePush(user.id);
    setBusy(false);
    setSubscribed(false);
  };

  if (perm === 'unsupported') {
    return (
      <p className="hint">
        Notifications aren’t available in this browser yet. On iPhone, open
        Percolate from your <strong>Home Screen icon</strong> (not Safari) to
        turn them on.
      </p>
    );
  }
  if (perm === 'denied') {
    return (
      <p className="hint">
        Notifications are blocked in your browser settings. You can flip them
        back on there anytime.
      </p>
    );
  }
  if (perm === 'granted' && subscribed) {
    return (
      <>
        <p className="hint granted">
          Notifications are on 🔔 You’ll be pinged on mentions and private
          messages.
        </p>
        <button className="btn ghost" onClick={disable} disabled={busy} style={{ marginTop: 8 }}>
          {busy ? 'Turning off…' : 'Turn off'}
        </button>
      </>
    );
  }
  return (
    <>
      <button className="btn primary" onClick={enable} disabled={busy}>
        {busy ? 'Turning on…' : 'Turn on notifications 🔔'}
      </button>
      {error && <p className="hint error-hint">{error}</p>}
      <p className="hint" style={{ marginTop: 8 }}>
        On iPhone, this only works from the Home Screen icon — if nothing
        happens, open Percolate from there first.
      </p>
    </>
  );
}

export function Onboarding() {
  const { createProfile, finishOnboarding } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('☕️');
  const [profileMade, setProfileMade] = useState(false);

  // Live-preview the accent as you pick your icon.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentForEmoji(emoji));
  }, [emoji]);

  const next = () => {
    if (step === 0 && !profileMade) {
      createProfile(name.trim(), emoji);
      setProfileMade(true);
    }
    if (step === 3) {
      finishOnboarding();
      return;
    }
    setStep(step + 1);
  };

  return (
    <div className="onboard">
      <div className="slide">
        {step === 0 && (
          <>
            <div className="onboard-hero">☕️</div>
            <h1>Welcome to Percolate</h1>
            <p className="sub">
              The cozy little team room for Fireweed Coffee Co. Chat, schedules,
              stock lists, and hours — all in one warm mug.
            </p>
            <label className="field-label">What should we call you?</label>
            <input
              className="big-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
            />
            <div className="emoji-pick">
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  className={'emoji-opt' + (e === emoji ? ' picked' : '')}
                  onClick={() => setEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <div className="onboard-hero">📲</div>
            <h1>Put it on your Home Screen</h1>
            <p className="sub">
              Percolate works like a real app — no App Store required. Here’s
              how to pin it:
            </p>
            <InstallHelp />
          </>
        )}
        {step === 2 && (
          <>
            <div className="onboard-hero">🔔</div>
            <h1>Want a nudge?</h1>
            <p className="sub">
              Get a gentle ping when someone posts, when the schedule changes,
              or when the pot’s fresh. Totally optional.
            </p>
            <NotificationSetup />
          </>
        )}
        {step === 3 && (
          <>
            <div className="onboard-hero">✨</div>
            <h1>The grand tour</h1>
            <ul className="tour">
              <li>
                <span>💬</span>
                <div>
                  <strong>Channels</strong> — chat with the crew. Use{' '}
                  <strong>**bold**</strong> and <code>- bullets</code> for tidy
                  order lists.
                </div>
              </li>
              <li>
                <span>📅</span>
                <div>
                  <strong>Scheduling</strong> — tap a day, raise your hand,
                  you’re on the books.
                </div>
              </li>
              <li>
                <span>📦</span>
                <div>
                  <strong>Stock &amp; roast boards</strong> — shared checklists
                  anyone can add to, and the boss can check off.
                </div>
              </li>
              <li>
                <span>⏱</span>
                <div>
                  <strong>Hours</strong> — log your time in seconds; payroll
                  adds itself up.
                </div>
              </li>
            </ul>
          </>
        )}
      </div>

      <div className="onboard-footer">
        <div className="dots-nav">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={'dot-nav' + (i === step ? ' dot-on' : '')} />
          ))}
        </div>
        <button
          className="btn primary big"
          disabled={step === 0 && name.trim().length === 0}
          onClick={next}
        >
          {step === 3 ? 'Start brewing →' : 'Continue'}
        </button>
        {step > 0 && step < 3 && (
          <button className="btn ghost" onClick={() => setStep(step + 1)}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

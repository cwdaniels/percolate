import React, { useState } from 'react';
import { useAuth } from '../auth';

export function SignIn() {
  const { sendMagicLink } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    const { error } = await sendMagicLink(email);
    if (error) {
      setError(error);
      setStatus('error');
    } else {
      setStatus('sent');
    }
  };

  if (status === 'sent') {
    return (
      <div className="onboard">
        <div className="slide">
          <div className="onboard-hero no-bob">📬</div>
          <h1>Check your inbox</h1>
          <p className="sub">
            We sent a one-tap sign-in link to <strong>{email.trim()}</strong>. Open
            it on this device and you’re in — no password needed.
          </p>
          <p className="hint" style={{ textAlign: 'center' }}>
            Didn’t get it? Check spam, or{' '}
            <button
              className="link"
              onClick={() => {
                setStatus('idle');
                setError('');
              }}
            >
              try a different email
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard">
      <div className="slide">
        <div className="onboard-hero">☕️</div>
        <h1>Welcome to Percolate</h1>
        <p className="sub">
          The cozy little team room for Fireweed Coffee Co. Sign in with your
          email — we’ll send a link, no password to remember.
        </p>
        <form onSubmit={submit}>
          <label className="field-label">Your email</label>
          <input
            className="big-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
          />
          {status === 'error' && <p className="hint error-hint">{error}</p>}
          <button
            className="btn primary big"
            type="submit"
            disabled={status === 'sending' || !email.trim()}
            style={{ marginTop: 16 }}
          >
            {status === 'sending' ? 'Sending…' : 'Email me a sign-in link →'}
          </button>
        </form>
      </div>
      <p className="footnote">Percolate ☕️ · brewed for Fireweed Coffee Co</p>
    </div>
  );
}

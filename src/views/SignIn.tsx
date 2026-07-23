import React, { useState } from 'react';
import { useAuth } from '../auth';

export function SignIn() {
  const { sendMagicLink, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState('');

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

  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setVerifying(true);
    setCodeError('');
    const { error } = await verifyCode(email, code);
    setVerifying(false);
    if (error) setCodeError(error);
    // On success, the auth listener flips the app in automatically.
  };

  if (status === 'sent') {
    return (
      <div className="onboard">
        <div className="slide">
          <div className="onboard-hero no-bob">📬</div>
          <h1>Check your inbox</h1>
          <p className="sub">
            We sent a message to <strong>{email.trim()}</strong> with a 6-digit
            code.
          </p>

          <form onSubmit={confirmCode} style={{ marginTop: 8 }}>
            <label className="field-label">Enter the code</label>
            <input
              className="big-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              autoFocus
              style={{ textAlign: 'center', letterSpacing: '0.2em', fontVariantNumeric: 'tabular-nums' }}
            />
            {codeError && <p className="hint error-hint">{codeError}</p>}
            <button
              className="btn primary big"
              type="submit"
              disabled={verifying || !code.trim()}
              style={{ marginTop: 16 }}
            >
              {verifying ? 'Checking…' : 'Confirm code →'}
            </button>
          </form>

          <p className="hint" style={{ textAlign: 'center', marginTop: 16 }}>
            Using Percolate from your Home Screen? Type the code above rather
            than tapping the link in the email — the link opens Safari, which
            won’t keep you signed in on the installed app.
          </p>
          <p className="hint" style={{ textAlign: 'center' }}>
            Didn’t get it? Check spam, or{' '}
            <button
              className="link"
              onClick={() => {
                setStatus('idle');
                setError('');
                setCode('');
                setCodeError('');
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
          email — we’ll send a code, no password to remember.
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
            {status === 'sending' ? 'Sending…' : 'Email me a code →'}
          </button>
        </form>
      </div>
      <p className="footnote">Percolate ☕️ · brewed for Fireweed Coffee Co</p>
    </div>
  );
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider, useAuth } from './auth';
import { SignIn } from './views/SignIn';
import { TeamGate } from './views/TeamSetup';
import { SupabaseStoreProvider } from './supastore';
import './styles.css';

// MIGRATION — slice 2: sign in → team → the real app, running on this team's
// live Supabase rows (via SupabaseStoreProvider, which fills the same store
// context the views already read).
function Gate() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="onboard">
        <div className="slide">
          <div className="onboard-hero">☕️</div>
          <p className="sub">Warming up…</p>
        </div>
      </div>
    );
  }
  if (!session) return <SignIn />;
  return (
    <TeamGate>
      {(team) => (
        <SupabaseStoreProvider team={team}>
          <App />
        </SupabaseStoreProvider>
      )}
    </TeamGate>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <Gate />
    </AuthProvider>
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js');
}

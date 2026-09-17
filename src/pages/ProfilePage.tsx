import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAuth } from '@/lib/auth-context';
import { sendPasswordRecovery } from '@/lib/auth';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';
import { getProfileFirestore, loadProfileSettings, type LoadedProfileSettings, type NotificationPreferences, type UserSettings } from '@/lib/profile-settings';
import { requestAccountDeletion, updateProfileSettings } from '@/lib/phase7-service';
import { updatePrivacySettings } from '@/lib/phase2-service';
import { useTeamContext } from '@/lib/team-context';
import { usePreferences } from '@/lib/preferences-context';

export function ProfilePage() {
  const { user, auth } = useAuth();
  const { teams } = useTeamContext();
  const { applyPreferences } = usePreferences();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<LoadedProfileSettings | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const activeUserId = useRef(user?.uid ?? null);
  activeUserId.current = user?.uid ?? null;

  useEffect(() => {
    let current = true;
    if (!user) return () => { current = false; };
    void loadProfileSettings(getProfileFirestore(), user.uid).then((loaded) => {
      if (current) { setSettings(loaded); setStatus('ready'); }
    }).catch((error: unknown) => {
      if (current) { setRequestState(getRequestState(error, navigator.onLine)); setStatus('error'); }
    });
    return () => { current = false; };
  }, [user]);

  // The provider owns `html[data-*]`, so the whole session honours a preference on
  // any entry route. This only previews the edits made on this page.
  useEffect(() => {
    if (settings) applyPreferences(settings.preferences);
  }, [applyPreferences, settings]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !settings || !online) return;
    const startedUserId = user.uid;
    setBusy(true);
    setRequestState(null);
    setMessage(null);
    try {
      await updateProfileSettings({
        displayName: settings.profile.displayName,
        photoURL: settings.profile.photoURL,
        ...settings.preferences,
        ...settings.notifications,
        ...(typeof settings.privacy.isMinor === 'boolean' ? { isMinor: settings.privacy.isMinor } : {})
      });
      // The privacy record is a separate server-owned document; saving the
      // profile alone left the minor flag and visibility unenforced.
      await updatePrivacySettings(typeof settings.privacy.isMinor === 'boolean' ? { isMinor: settings.privacy.isMinor } : {});
      if (activeUserId.current !== startedUserId) return;
      setMessage({ title: 'Profile saved', body: 'Your profile and preferences are saved. Safety notifications remain enabled.' });
    } catch (error) {
      if (activeUserId.current === startedUserId) setRequestState(getRequestState(error, online));
    } finally {
      if (activeUserId.current === startedUserId) setBusy(false);
    }
  }

  async function sendRecovery() {
    if (!auth || !user?.email || !online) return;
    setBusy(true);
    try { await sendPasswordRecovery(auth, user.email); setMessage({ title: 'Check your inbox', body: 'A password reset link was sent to your account email.' }); }
    catch (error) { setRequestState(getRequestState(error, online)); }
    finally { setBusy(false); }
  }

  async function deleteAccount() {
    if (!online || !window.confirm('Request deletion of your First Pit account? A support-admin workflow will review the request.')) return;
    setBusy(true);
    try { await requestAccountDeletion(); setMessage({ title: 'Deletion requested', body: 'Account deletion requested. A support administrator will complete the safety review.' }); }
    catch (error) { setRequestState(getRequestState(error, online)); }
    finally { setBusy(false); }
  }

  if (!user) return <StatePanel variant="permission" title="Sign in to manage your profile" message="Profile customization is private to your authenticated account." actionLabel="Sign in" onAction={() => navigate('/auth')} />;
  if (status === 'loading') return <StatePanel variant="loading" title="Loading your profile" message="Fetching private profile, accessibility, privacy, and notification settings." />;
  if (status === 'error' || !settings) return <StatePanel {...(requestState ?? { variant: 'error' as const, title: 'Profile could not load', message: 'Try again.' })} actionLabel="Retry" onAction={() => window.location.reload()} autoFocus />;

  const updatePreferences = (next: Partial<UserSettings>) => setSettings((current) => current ? { ...current, preferences: { ...current.preferences, ...next } } : current);
  const updateNotifications = (next: Partial<NotificationPreferences>) => setSettings((current) => current ? { ...current, notifications: { ...current.notifications, ...next, safetyNotifications: true } } : current);
  return (
    <div className="page-stack">
      <section className="team-hero">
        <div className="profile-preview">
          <span className="big-avatar color-1">{settings.profile.displayName.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'FP'}</span>
          <div><span className="eyebrow light">PERSONAL PROFILE</span><h3>{settings.profile.displayName}</h3><p>{user.email ?? 'Private account'} · team-only profile</p></div>
        </div>
        <button type="submit" form="profile-settings" disabled={busy || !online}>{busy ? 'Saving…' : 'Save profile'}</button>
      </section>
      {!online ? <StatePanel variant="offline" title="You are offline" message="Profile changes are paused until you reconnect." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} /> : null}
      {message ? <StatePanel variant="success" title={message.title} message={message.body} actionLabel="Dismiss" onAction={() => setMessage(null)} /> : null}
      <form id="profile-settings" className="page-stack" onSubmit={submit}>
        <section className="split-panels">
          <article className="feature-panel"><span className="eyebrow">DISPLAY PROFILE</span><h3>How teammates see you</h3><p>Only your active team memberships can access this profile.</p><div className="form-stack"><label>Display name<input value={settings.profile.displayName} maxLength={80} onChange={(event) => setSettings({ ...settings, profile: { ...settings.profile, displayName: event.target.value } })} required /></label><label>Profile picture URL <span className="muted">(optional)</span><input type="url" value={settings.profile.photoURL ?? ''} onChange={(event) => setSettings({ ...settings, profile: { ...settings.profile, photoURL: event.target.value || null } })} placeholder="https://…" /></label></div><p>Email: {user.email ?? 'Not available'}. Precise location and unnecessary child information are not collected.</p></article>
          <article className="feature-panel"><span className="eyebrow">MEMBERSHIPS</span><h3>Your private teams</h3><p>Only verified active memberships appear here.</p><div>{teams.length ? teams.map((team) => <span key={team.teamId}>{team.team?.name ?? 'Unnamed team'} · {team.role}</span>) : <span>No active teams</span>}</div></article>
        </section>
        <section className="split-panels">
          <article className="feature-panel"><span className="eyebrow">APPEARANCE & ACCESSIBILITY</span><h3>Make First Pit comfortable</h3><div className="form-stack"><label>Theme<select value={settings.preferences.theme} onChange={(event) => updatePreferences({ theme: event.target.value as UserSettings['theme'] })}><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="checkbox-row"><input type="checkbox" checked={settings.preferences.highContrast} onChange={(event) => updatePreferences({ highContrast: event.target.checked })} /> High contrast</label><label className="checkbox-row"><input type="checkbox" checked={settings.preferences.reducedMotion} onChange={(event) => updatePreferences({ reducedMotion: event.target.checked })} /> Reduce motion</label><label>Text size<select value={settings.preferences.fontScale} onChange={(event) => updatePreferences({ fontScale: event.target.value as UserSettings['fontScale'] })}><option value="default">Default</option><option value="large">Large</option></select></label></div></article>
          <article className="feature-panel"><span className="eyebrow">NOTIFICATIONS</span><h3>Choose your updates</h3><p>Assignments, moderation, and safety notices cannot be suppressed.</p><div className="form-stack"><label className="checkbox-row"><input type="checkbox" checked={settings.notifications.emailNotifications} onChange={(event) => updateNotifications({ emailNotifications: event.target.checked })} /> Email notifications</label><label className="checkbox-row"><input type="checkbox" checked={settings.notifications.pushNotifications} onChange={(event) => updateNotifications({ pushNotifications: event.target.checked })} /> Push notifications</label><label className="checkbox-row"><input type="checkbox" checked disabled /> Safety notifications (always on)</label></div></article>
        </section>
        <section className="split-panels">
          <article className="feature-panel"><span className="eyebrow">PRIVACY</span><h3>Team-only by default</h3><p>Parent visibility and private conversations follow explicit team policy.</p><div><span>Visibility: team members</span><span>Searchable: no</span><span>Public profile: no</span></div><label className="checkbox-row"><input type="checkbox" checked={settings.privacy.isMinor === true} onChange={(event) => setSettings({ ...settings, privacy: { ...settings.privacy, isMinor: event.target.checked } })} /> I am under 18</label></article>
          <article className="feature-panel"><span className="eyebrow">SESSION & ACCOUNT</span><h3>Account controls</h3><p>Use a reset email to update your password. Sign out stays available in the team shell.</p><div className="form-actions"><button className="button button--ghost" type="button" disabled={busy || !online || !user.email} onClick={() => void sendRecovery()}>Send password reset</button><button className="button button--danger" type="button" disabled={busy || !online} onClick={() => void deleteAccount()}>Request account deletion</button></div></article>
        </section>
        <button className="button" type="submit" disabled={busy || !online}>{busy ? 'Saving…' : 'Save profile & preferences'}</button>
      </form>
      <section className="split-panels">
      </section>
    </div>
  );
}

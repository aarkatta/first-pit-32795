import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { getFirebaseServices } from './firebase';

export type ProfileSettings = {
  displayName: string;
  photoURL: string | null;
};

export type NotificationPreferences = {
  emailNotifications: boolean;
  pushNotifications: boolean;
  safetyNotifications: true;
};

export type UserSettings = {
  theme: 'light' | 'dark' | 'system';
  highContrast: boolean;
  reducedMotion: boolean;
  fontScale: 'default' | 'large';
};

export type PrivacySettings = {
  profileVisibility: 'teamOnly';
  searchable: false;
  allowParentVisibility: false;
  privateConversations: false;
  isMinor?: boolean;
};

export type LoadedProfileSettings = {
  profile: ProfileSettings;
  notifications: NotificationPreferences;
  preferences: UserSettings;
  privacy: PrivacySettings;
};

const defaultSettings: UserSettings = {
  theme: 'system',
  highContrast: false,
  reducedMotion: false,
  fontScale: 'default'
};

export async function loadProfileSettings(firestore: Firestore, uid: string): Promise<LoadedProfileSettings> {
  const [profileSnapshot, notificationSnapshot, settingsSnapshot, privacySnapshot] = await Promise.all([
    getDoc(doc(firestore, 'users', uid)),
    getDoc(doc(firestore, 'notificationPreferences', uid)),
    getDoc(doc(firestore, 'userSettings', uid)),
    getDoc(doc(firestore, 'privacySettings', uid))
  ]);
  const profile = profileSnapshot.data() ?? {};
  const notifications = notificationSnapshot.data() ?? {};
  const settings = settingsSnapshot.data() ?? {};
  const privacy = privacySnapshot.data() ?? {};
  return {
    profile: { displayName: String(profile.displayName ?? 'First Pit member'), photoURL: typeof profile.photoURL === 'string' ? profile.photoURL : null },
    notifications: { emailNotifications: notifications.emailNotifications !== false, pushNotifications: notifications.pushNotifications === true, safetyNotifications: true },
    preferences: {
      theme: settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : defaultSettings.theme,
      highContrast: settings.highContrast === true,
      reducedMotion: settings.reducedMotion === true,
      fontScale: settings.fontScale === 'large' ? 'large' : defaultSettings.fontScale
    },
    privacy: { profileVisibility: 'teamOnly', searchable: false, allowParentVisibility: false, privateConversations: false, ...(typeof privacy.isMinor === 'boolean' ? { isMinor: privacy.isMinor } : {}) }
  };
}

export function getProfileFirestore() {
  return getFirebaseServices().firestore;
}

import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { getFirebaseServices } from './firebase';

function fallbackDisplayName(user: User) {
  if (user.displayName?.trim()) return user.displayName.trim();
  if (user.email?.includes('@')) return user.email.split('@')[0];
  return 'First Pit member';
}

/** Creates the authenticated user's private profile before entering the app. */
export async function bootstrapUserProfile(user: User): Promise<void> {
  const { firestore } = getFirebaseServices();
  const profileRef = doc(firestore, 'users', user.uid);
  const notificationPreferencesRef = doc(firestore, 'notificationPreferences', user.uid);
  const privacySettingsRef = doc(firestore, 'privacySettings', user.uid);
  await runTransaction(firestore, async (transaction) => {
    const existingProfile = await transaction.get(profileRef);
    const existingNotificationPreferences = await transaction.get(notificationPreferencesRef);
    const existingPrivacySettings = await transaction.get(privacySettingsRef);
    if (existingProfile.exists()) {
      const profile = existingProfile.data() ?? {};
      const missingDefaults: Record<string, unknown> = {};
      if (typeof profile.displayName !== 'string' || !profile.displayName.trim()) missingDefaults.displayName = fallbackDisplayName(user);
      if (!Object.prototype.hasOwnProperty.call(profile, 'photoURL')) missingDefaults.photoURL = user.photoURL ?? null;
      // `email` is deliberately not backfilled here. The rules pin it to the
      // value written at create time — `affectedKeys().hasOnly(['displayName',
      // 'photoURL', 'updatedAt'])` — so including it turned every sign-in on a
      // profile missing the field into a permission-denied that read to the
      // user as "ask a coach". `updateProfileSettings` writes it server-side.
      if (Object.keys(missingDefaults).length) transaction.update(profileRef, { ...missingDefaults, updatedAt: serverTimestamp() });
    } else {
      transaction.set(profileRef, {
        uid: user.uid,
        email: user.email ?? null,
        displayName: fallbackDisplayName(user),
        photoURL: user.photoURL ?? null,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    }
    if (!existingNotificationPreferences.exists()) transaction.set(notificationPreferencesRef, {
      userId: user.uid,
      emailNotifications: true,
      pushNotifications: false,
      safetyNotifications: true,
      updatedAt: serverTimestamp()
    });
    if (!existingPrivacySettings.exists()) transaction.set(privacySettingsRef, {
      userId: user.uid,
      profileVisibility: 'teamOnly',
      searchable: false,
      allowParentVisibility: false,
      privateConversations: false,
      updatedAt: serverTimestamp()
    });
  });
}

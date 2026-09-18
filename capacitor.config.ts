import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.firstpit.app',
  appName: 'First Pit',
  webDir: 'dist',
  ios: {
    // The page is laid out full-bleed (viewport-fit=cover) and pads itself with
    // env(safe-area-inset-*). An 'automatic' inset would pad a second time and
    // show the bare web view behind the home indicator.
    contentInset: 'never'
  },
  plugins: {
    SplashScreen: {
      // main.tsx hides the splash after the first paint; this is only the cap
      // for a bundle that never gets that far.
      launchShowDuration: 10000,
      launchAutoHide: true,
      backgroundColor: '#12211a',
      showSpinner: false
    },
    FirebaseAuthentication: {
      // The native layer only obtains Google's ID token; the Firebase JS SDK
      // signs in with it and owns the session, exactly as on the web.
      skipNativeAuth: true,
      providers: ['google.com']
    }
  },
  experimental: {
    ios: {
      spm: {
        swiftToolsVersion: '6.1',
        // Only the Google Sign-In SDK; the default traits also pull in Facebook.
        packageTraits: {
          '@capacitor-firebase/authentication': ['Google']
        }
      }
    }
  }
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.firstpit.app',
  appName: 'First Pit',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic'
  }
};

export default config;

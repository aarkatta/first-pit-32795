// Gate between `vite build --mode ios` and `cap sync ios`: the bundle copied
// into Xcode must be a production bundle. Vite inlines import.meta.env into the
// JS, so the flags are checked in the built output itself — the web build has
// the runtime guard in src/lib/env.ts, but a store binary that fails that guard
// at launch is already shipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const assetsDir = join(process.cwd(), 'dist', 'assets');
if (!existsSync(assetsDir)) throw new Error('dist/assets is missing; run the iOS build first.');

const bundle = readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(join(assetsDir, name), 'utf8'))
  .join('\n');

const failures = [];
if (!bundle.includes('MODE:"ios"')) failures.push('bundle was not built with --mode ios');
if (/VITE_USE_FIREBASE_EMULATORS:"true"/.test(bundle)) failures.push('Firebase emulators are enabled');
if (!/VITE_USE_FIREBASE_EMULATORS:"false"/.test(bundle)) failures.push('VITE_USE_FIREBASE_EMULATORS is not explicitly "false"');
const projectId = bundle.match(/VITE_FIREBASE_PROJECT_ID:"([^"]*)"/)?.[1];
if (!projectId || projectId.startsWith('demo-')) failures.push(`Firebase project id is ${projectId ? `"${projectId}"` : 'missing'}, not a real project`);

const publicOrigin = bundle.match(/VITE_PUBLIC_WEB_ORIGIN:"([^"]*)"/)?.[1];
if (!publicOrigin?.startsWith('https://')) failures.push('VITE_PUBLIC_WEB_ORIGIN is missing or not https (invite and email links need it)');

if (failures.length > 0) {
  throw new Error(`iOS bundle check failed (see .env.ios.example):\n- ${failures.join('\n- ')}`);
}
console.log(`iOS bundle check passed: production build for Firebase project "${projectId}", emulators off, public site ${publicOrigin}.`);

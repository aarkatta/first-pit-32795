import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const requiredFiles = [
  'capacitor.config.ts',
  'vercel.json',
  'firestore.rules',
  'storage.rules',
  'firestore.indexes.json',
  'src/lib/env.ts',
  'docs/architecture.md'
];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) throw new Error(`Release file is missing: ${file}`);
}

const packageJson = JSON.parse(read('package.json'));
const capacitorConfig = read('capacitor.config.ts');
const vercelConfig = JSON.parse(read('vercel.json'));
const envSource = read('src/lib/env.ts');
const indexHtml = read('index.html');

if (!packageJson.dependencies?.['@capacitor/core']) throw new Error('Capacitor core is not installed.');
if (!packageJson.devDependencies?.['@capacitor/cli']) throw new Error('Capacitor CLI is not installed.');
if (!capacitorConfig.includes("appId: 'com.firstpit.app'")) throw new Error('Capacitor app ID is not configured.');
if (!capacitorConfig.includes("contentInset: 'never'")) throw new Error('iOS content inset must be \'never\': the page pads itself for safe areas.');
if (vercelConfig.outputDirectory !== 'dist' || !Array.isArray(vercelConfig.rewrites) || vercelConfig.rewrites.length === 0) {
  throw new Error('Vercel SPA output or rewrite configuration is incomplete.');
}
if (!envSource.includes('Firebase emulators cannot be enabled in production')) {
  throw new Error('Production emulator guard is missing.');
}
if (!indexHtml.includes('viewport-fit=cover')) throw new Error('Safe-area viewport metadata is missing.');

// Universal Links: iOS fetches this file from the production domain, and it
// must be JSON at exactly this path (no redirect, not the SPA's index.html).
const aasaPath = 'public/.well-known/apple-app-site-association';
if (!existsSync(join(root, aasaPath))) throw new Error(`${aasaPath} is missing.`);
let aasa;
try {
  aasa = JSON.parse(read(aasaPath));
} catch {
  throw new Error(`${aasaPath} is not valid JSON.`);
}
const aasaAppIds = (aasa.applinks?.details ?? []).flatMap((detail) => detail.appIDs ?? []);
if (!aasaAppIds.some((id) => /^[A-Z0-9]{10}\.com\.firstpit\.app$/.test(id))) {
  throw new Error(`${aasaPath} must list <TEAMID>.com.firstpit.app in applinks.details[].appIDs.`);
}
if (!vercelConfig.rewrites.every((rewrite) => rewrite.source.includes('\\.well-known/'))) {
  throw new Error('The Vercel SPA rewrite must exclude /.well-known/ so the association file is served as-is.');
}
const aasaHeader = (vercelConfig.headers ?? []).find((entry) => entry.source === '/.well-known/apple-app-site-association');
if (!aasaHeader?.headers?.some((header) => header.key.toLowerCase() === 'content-type' && header.value === 'application/json')) {
  throw new Error('vercel.json must serve the association file as application/json.');
}

// Browser-tab icon, iOS home-screen icon, and link-preview metadata. Without these a
// shared First Pit link renders as a bare grey URL and the tab shows a blank page icon.
const brandingTags = [
  { pattern: /<link[^>]+rel=["']icon["'][^>]+href=["']\/favicon\.svg["']/i, message: 'SVG favicon link is missing from index.html.' },
  { pattern: /<link[^>]+rel=["']icon["'][^>]+href=["']\/favicon\.ico["']/i, message: 'favicon.ico link is missing from index.html.' },
  { pattern: /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']\/apple-touch-icon\.png["']/i, message: 'apple-touch-icon link is missing from index.html.' },
  { pattern: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{40,}["']/i, message: 'A meaningful <meta name="description"> is missing from index.html.' },
  { pattern: /<meta[^>]+property=["']og:title["']/i, message: 'og:title is missing from index.html.' },
  { pattern: /<meta[^>]+property=["']og:description["']/i, message: 'og:description is missing from index.html.' },
  { pattern: /<meta[^>]+property=["']og:image["'][^>]+content=["'][^"']*\/og-image\.png["']/i, message: 'og:image is missing from index.html.' },
  { pattern: /<meta[^>]+name=["']twitter:card["'][^>]+content=["']summary_large_image["']/i, message: 'twitter:card is missing from index.html.' }
];
for (const { pattern, message } of brandingTags) {
  if (!pattern.test(indexHtml)) throw new Error(message);
}

const brandAssets = [
  'public/favicon.svg',
  'public/favicon.ico',
  'public/apple-touch-icon.png',
  'public/og-image.png'
];
for (const asset of brandAssets) {
  const assetPath = join(root, asset);
  if (!existsSync(assetPath)) throw new Error(`Brand asset referenced by index.html is missing: ${asset}`);
  if (statSync(assetPath).size === 0) throw new Error(`Brand asset is empty: ${asset}`);
}

// The two raster assets must be real PNGs at the sizes the meta tags promise.
function pngDimensions(relativePath) {
  const header = readFileSync(join(root, relativePath)).subarray(0, 33);
  const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng || header.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`${relativePath} is not a valid PNG.`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

const appleIcon = pngDimensions('public/apple-touch-icon.png');
if (appleIcon.width !== 180 || appleIcon.height !== 180) {
  throw new Error(`apple-touch-icon.png must be 180x180, found ${appleIcon.width}x${appleIcon.height}.`);
}
const ogImage = pngDimensions('public/og-image.png');
if (ogImage.width !== 1200 || ogImage.height !== 630) {
  throw new Error(`og-image.png must be 1200x630, found ${ogImage.width}x${ogImage.height}.`);
}

function filesUnder(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) return [];
  if (statSync(absolutePath).isFile()) return [relativePath];
  return readdirSync(absolutePath, { withFileTypes: true })
    .filter((entry) => !['node_modules', '.git', 'dist', 'coverage'].includes(entry.name))
    .flatMap((entry) => filesUnder(join(relativePath, entry.name)));
}

// Every committed env template is scanned, not just .env.example.
const envTemplates = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.startsWith('.env') && entry.name.endsWith('.example'))
  .map((entry) => entry.name);
const sourceFiles = [...envTemplates, 'capacitor.config.ts', 'src', 'functions', 'docs'].flatMap(filesUnder);
const suspiciousSecrets = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{20,})/;
for (const file of sourceFiles) {
  const content = read(file);
  if (content && suspiciousSecrets.test(content)) throw new Error(`Potential secret found in ${file}.`);
}

console.log('Release check passed: Capacitor metadata, Vercel routing, Universal Links association, safe-area metadata, brand/social metadata and assets, and the production emulator guard are present.');

import { describe, expect, it } from 'vitest';
import { publicWebOrigin } from './public-origin';

describe('publicWebOrigin', () => {
  it('uses the page origin on the web', () => {
    expect(publicWebOrigin({ native: false, pageOrigin: 'https://preview.example.com', configured: 'https://www.first-pit.com' }))
      .toBe('https://preview.example.com');
  });

  it('uses the configured public site in the iOS shell, never capacitor://', () => {
    expect(publicWebOrigin({ native: true, pageOrigin: 'capacitor://localhost', configured: 'https://www.first-pit.com/some/path' }))
      .toBe('https://www.first-pit.com');
  });

  it('refuses a missing or non-https origin in the shell', () => {
    expect(() => publicWebOrigin({ native: true, pageOrigin: 'capacitor://localhost', configured: undefined })).toThrow(/https/);
    expect(() => publicWebOrigin({ native: true, pageOrigin: 'capacitor://localhost', configured: 'http://www.first-pit.com' })).toThrow(/https/);
  });
});

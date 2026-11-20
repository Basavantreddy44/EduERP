import localFont from 'next/font/local';

/**
 * Brand fonts, shipped with the app (src/fonts, SIL Open Font License) and self-hosted by Next — no
 * request to Google at build time or from visitors. Loading them from Google during the build failed
 * on Vercel (the font loader could not read a file name Google returned), so the files live in the repo.
 * Variable fonts: one file covers every weight.
 */
export const displayFont = localFont({
  src: [
    { path: '../fonts/playfair-latin.woff2', weight: '400 900', style: 'normal' },
    { path: '../fonts/playfair-italic-latin.woff2', weight: '400 900', style: 'italic' },
  ],
  variable: '--font-display',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
});
export const sansFont = localFont({
  src: [{ path: '../fonts/manrope-latin.woff2', weight: '200 800', style: 'normal' }],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
});
/** Manrope has no Kannada glyphs; Noto Sans Kannada is used for Kannada text (falls through the font stack). */
export const kannadaFont = localFont({
  src: [{ path: '../fonts/noto-sans-kannada.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-kn',
  display: 'swap',
  preload: false,
});

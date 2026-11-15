import { Manrope, Noto_Sans_Kannada, Playfair_Display } from 'next/font/google';

/** Brand fonts, self-hosted by Next at build time (no request to Google from visitors). */
export const displayFont = Playfair_Display({ subsets: ['latin'], weight: ['500', '600', '700'], style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });
export const sansFont = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-sans', display: 'swap' });
/** Manrope has no Kannada glyphs; Noto Sans Kannada is used for Kannada text (falls through the font stack). */
export const kannadaFont = Noto_Sans_Kannada({ subsets: ['kannada'], weight: ['400', '500', '600', '700'], variable: '--font-kn', display: 'swap' });

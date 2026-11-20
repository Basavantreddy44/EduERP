# Bundled fonts

Variable WOFF2 files used by `src/lib/fonts.ts` through `next/font/local`. They are part of the repository so the
build never downloads fonts (the `next/font/google` download failed on Vercel).

| File | Font | Subset | Licence |
|---|---|---|---|
| `manrope-latin.woff2` | Manrope (weights 200–800) | Latin | SIL Open Font License 1.1 |
| `playfair-latin.woff2`, `playfair-italic-latin.woff2` | Playfair Display (weights 400–900, normal and italic) | Latin | SIL Open Font License 1.1 |
| `noto-sans-kannada.woff2` | Noto Sans Kannada (weights 100–900) | Kannada | SIL Open Font License 1.1 |

Source: Google Fonts (fonts.gstatic.com), downloaded 2026-11-20. To refresh, download the same families' variable
WOFF2 files for these subsets and replace the files.

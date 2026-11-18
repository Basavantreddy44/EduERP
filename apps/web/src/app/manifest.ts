import type { MetadataRoute } from 'next';

/** Web-app manifest (M5.3): lets parents, students and staff add EduERP to their phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'EduERP',
    short_name: 'EduERP',
    description: 'Attendance, fees and school updates in one app',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f4ef',
    theme_color: '#0a1430',
    lang: 'en',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

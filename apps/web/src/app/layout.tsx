import type { Metadata, Viewport } from 'next';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui';
import { displayFont, kannadaFont, sansFont } from '@/lib/fonts';
import { I18nProvider } from '@/lib/i18n';
import { PwaSetup } from '@/components/pwa';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'EduERP', template: '%s · EduERP' },
  description: 'School & College ERP',
  appleWebApp: { capable: true, title: 'EduERP', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a1430' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${sansFont.variable} ${kannadaFont.variable}`}>
      <body>
        <I18nProvider>
          <SessionProvider>
            <ToastProvider>{children}</ToastProvider>
            <PwaSetup />
          </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui';
import { displayFont, kannadaFont, sansFont } from '@/lib/fonts';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = { title: { default: 'EduERP', template: '%s · EduERP' }, description: 'School & College ERP' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a1430' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${sansFont.variable} ${kannadaFont.variable}`}>
      <body>
        <I18nProvider>
          <SessionProvider>
            <ToastProvider>{children}</ToastProvider>
          </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

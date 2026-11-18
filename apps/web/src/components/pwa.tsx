'use client';

import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Registers the service worker once (production builds only) and keeps the browser's install offer. */
export function PwaSetup() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    const offer = (e: Event) => { e.preventDefault(); deferred = e as InstallPromptEvent; listeners.forEach((f) => f()); };
    const done = () => { deferred = null; listeners.forEach((f) => f()); };
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', offer); window.removeEventListener('appinstalled', done); };
  }, []);
  return null;
}

/**
 * Whether the app can be installed here, and how:
 * - 'prompt': the browser offered it (Android / desktop Chrome, Edge) — call install();
 * - 'ios': iPhone / iPad Safari — the person uses Share → Add to Home Screen;
 * - null: already installed, or the browser does not support it.
 */
export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setStandalone(window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
  }, []);
  const kind: 'prompt' | 'ios' | null = standalone ? null : deferred ? 'prompt' : ios ? 'ios' : null;
  return {
    kind,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      listeners.forEach((f) => f());
    },
  };
}

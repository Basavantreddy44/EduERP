'use client';

import { useEffect, useState } from 'react';

/** False during server render and the first client render; true once React has hydrated the page. */
export function useHydrated(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

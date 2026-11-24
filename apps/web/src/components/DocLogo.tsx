'use client';

import { logoUrl, useSession } from '@/lib/session';

/** The signed-in institution's logo for printed documents (receipts, payslips, orders, TCs); nothing when it has none. */
export function DocLogo({ className = 'doc-logo' }: { className?: string }) {
  const { institution } = useSession();
  const url = logoUrl(institution);
  return url ? <img className={className} src={url} alt="" width={64} height={64} /> : null;
}

/** Report cards and certificates: the logo, or the first letter of the school as before. */
export function Crest({ name }: { name: string }) {
  const { institution } = useSession();
  const url = logoUrl(institution);
  return url ? <img className="rc-crest rc-crest-logo" src={url} alt="" width={56} height={56} /> : <div className="rc-crest" aria-hidden="true">{name.slice(0, 1)}</div>;
}

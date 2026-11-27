'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavLink = { href: string; label: string };

export function Nav({ items, variant }: { items: NavLink[]; variant: 'side' | 'top' }) {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));
  return (
    <nav className={variant === 'side' ? 'nav' : 'mobilenav'}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={active(i.href) ? 'on' : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}

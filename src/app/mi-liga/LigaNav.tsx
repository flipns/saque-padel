"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/mi-liga", label: "Inicio", exact: true },
  { href: "/mi-liga/liga", label: "Liga" },
  { href: "/mi-liga/ranking", label: "Ranking" },
  { href: "/mi-liga/avisos", label: "Avisos" },
];

export function LigaNav({ className, unread = 0 }: { className?: string; unread?: number }) {
  const path = usePathname();
  return (
    <nav className={className} aria-label="Mi liga">
      {ITEMS.map((i) => {
        const on = i.exact ? path === i.href || path.startsWith("/mi-liga/partido") : i.href === "/mi-liga/liga" ? path.startsWith("/mi-liga/liga") || path.startsWith("/mi-liga/clasificacion") : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}>
            {i.label}{i.href === "/mi-liga/avisos" && unread > 0 && <span className="badge" aria-label={`${unread} sin leer`}>{unread > 9 ? "9+" : unread}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

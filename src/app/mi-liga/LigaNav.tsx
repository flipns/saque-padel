"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/mi-liga", label: "Inicio", exact: true },
  { href: "/mi-liga/clasificacion", label: "Clasificación" },
  { href: "/mi-liga/ranking", label: "Ranking" },
];

export function LigaNav({ className }: { className?: string }) {
  const path = usePathname();
  return (
    <nav className={className} aria-label="Mi liga">
      {ITEMS.map((i) => {
        const on = i.exact ? path === i.href || path.startsWith("/mi-liga/partido") : path.startsWith(i.href);
        return <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}>{i.label}</Link>;
      })}
    </nav>
  );
}

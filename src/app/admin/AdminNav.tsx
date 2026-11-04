"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Resumen", exact: true },
  { href: "/admin/parejas", label: "Parejas" },
  { href: "/admin/fases", label: "Grupos" },
  { href: "/admin/partidos", label: "Partidos" },
  { href: "/admin/clasificacion", label: "Clasificación" },
  { href: "/admin/ranking", label: "Ranking" },
  { href: "/admin/ajustes", label: "Ajustes" },
];

export function AdminNav({ className }: { className?: string }) {
  const path = usePathname();
  return (
    <nav className={className} aria-label="Panel">
      {ITEMS.map((i) => {
        const on = i.exact ? path === i.href : path.startsWith(i.href);
        return <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}>{i.label}</Link>;
      })}
    </nav>
  );
}

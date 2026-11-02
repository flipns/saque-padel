import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import s from "./admin.module.css";

export const metadata = { title: "Panel · SAQUE LEAGUE" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <Link href="/admin" className={s.brand}>
          <Image src="/brand/saque-white.png" alt="Saque" width={92} height={37} />
          <span>Panel de la liga</span>
        </Link>
        <nav className={s.nav} aria-label="Panel">
          <Link href="/admin">Resumen</Link>
          <Link href="/admin/importar">Importar inscripciones</Link>
        </nav>
        <form action="/salir" method="post" className={s.user}>
          <span>{user.email}</span>
          <button type="submit">Salir</button>
        </form>
      </header>
      <main className={`wrap ${s.main}`}>{children}</main>
    </div>
  );
}

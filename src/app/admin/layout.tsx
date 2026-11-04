import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { AdminNav } from "./AdminNav";
import s from "./admin.module.css";

export const metadata = { title: "Panel · SAQUE LEAGUE" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <div className={s.barInner}>
          <Link href="/admin" className={s.brand}>
            <Image src="/brand/saque-white.png" alt="Saque" width={92} height={37} priority />
            <span>Panel de la liga</span>
          </Link>
          <AdminNav className={s.nav} />
          <div className={s.user}>
            <Link href="/cuenta">Mi cuenta</Link>
            <form action="/salir" method="post"><button type="submit">Salir</button></form>
          </div>
        </div>
      </header>
      <main className={`wrap ${s.main}`}>{children}</main>
    </div>
  );
}

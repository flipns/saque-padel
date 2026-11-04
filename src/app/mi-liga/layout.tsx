import Image from "next/image";
import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import { LigaNav } from "./LigaNav";
import s from "./liga.module.css";

export const metadata = { title: "Mi liga · SAQUE LEAGUE" };

export default async function LigaLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = await requirePlayer();
  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <div className={s.barInner}>
          <Link href="/mi-liga" className={s.brand}><Image src="/brand/saque-white.png" alt="Saque" width={92} height={37} priority /></Link>
          <LigaNav className={s.nav} />
          <div className={s.user}>{isAdmin && <Link href="/admin" style={{ marginRight: ".5rem" }}>Panel</Link>}<Link href="/cuenta">Mi cuenta</Link></div>
        </div>
      </header>
      <main className={s.main}>{children}</main>
    </div>
  );
}

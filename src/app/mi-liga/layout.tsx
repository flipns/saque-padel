import Image from "next/image";
import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { unreadCount } from "@/lib/data";
import { LigaNav } from "./LigaNav";
import { MinorNotice } from "@/components/MinorNotice";
import s from "./liga.module.css";

export const metadata = { title: "Mi liga · SAQUE LEAGUE" };

export default async function LigaLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const [{ isAdmin }, unread] = await Promise.all([requirePlayer(), unreadCount(sb)]);
  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <div className={s.barInner}>
          <Link href="/mi-liga" className={s.brand}><Image src="/brand/saque-white.png" alt="Saque" width={92} height={37} priority /></Link>
          <LigaNav className={s.nav} unread={unread} />
          <div className={s.user}>{isAdmin && <Link href="/admin" style={{ marginRight: ".5rem" }}>Panel</Link>}<Link href="/cuenta">Mi cuenta</Link></div>
        </div>
      </header>
      <main className={s.main}><MinorNotice />{children}</main>
    </div>
  );
}

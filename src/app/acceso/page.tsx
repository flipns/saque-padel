import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import { destinationAfterLogin } from "@/lib/afterLogin";
import { LoginForm } from "./LoginForm";
import s from "./acceso.module.css";

export const metadata = { title: "Entrar · SAQUE LEAGUE" };

export default async function Acceso({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = "/", error } = await searchParams;

  // Con sesión abierta no hay nada que pedir: se va directo a su zona.
  if (supabaseConfigured()) {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    if (data.user) redirect(await destinationAfterLogin(sb, next));
  }

  return (
    <main className={s.page}>
      <Link href="/" className={s.logo}><Image src="/brand/saque-navy.png" alt="Saque, volver al inicio" width={140} height={56} /></Link>
      <div className={s.card}>
        <h1 className="title">Entrar</h1>
        <p className="muted">Usa el email con el que se inscribió tu pareja. Si el jugador es menor, el del tutor.</p>
        {error && <p role="alert" className="error">El enlace ha caducado o ya se usó. Pide uno nuevo.</p>}
        <LoginForm next={next} />
      </div>
    </main>
  );
}

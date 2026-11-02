import Image from "next/image";
import Link from "next/link";
import { LoginForm } from "./LoginForm";
import s from "./acceso.module.css";

export const metadata = { title: "Entrar · SAQUE LEAGUE" };

export default async function Acceso({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = "/", error } = await searchParams;
  return (
    <main className={s.page}>
      <Link href="/" className={s.logo}><Image src="/brand/saque-navy.png" alt="Saque, volver al inicio" width={140} height={56} /></Link>
      <div className={s.card}>
        <h1 className="title">Entrar</h1>
        <p className="muted">
          Te enviamos un enlace al email con el que inscribiste a tu pareja. Si el jugador es menor, usa el email del tutor.
        </p>
        {error && <p role="alert" className="error">El enlace ha caducado o ya se usó. Pide uno nuevo.</p>}
        <LoginForm next={next} />
      </div>
    </main>
  );
}

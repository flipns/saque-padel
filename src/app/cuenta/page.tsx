import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PasswordForm } from "../crear-contrasena/PasswordForm";
import s from "../acceso/acceso.module.css";

export const metadata = { title: "Mi cuenta · SAQUE LEAGUE" };

export default async function Cuenta() {
  const { sb, user } = await requireUser("/cuenta");
  const { data: isAdmin } = await sb.rpc("is_admin");
  return (
    <main className={s.page}>
      <Image src="/brand/saque-navy.png" alt="Saque" width={140} height={56} style={{ width: 120, height: "auto" }} />
      <div className={s.card}>
        <h1 className="title">Mi cuenta</h1>
        <p className="muted">Sesión iniciada como <b>{user.email}</b>.</p>
        <h2 style={{ fontSize: "1.1rem", margin: "1.5rem 0 .75rem" }}>Cambiar contraseña</h2>
        <PasswordForm mode="change" />
        <div style={{ display: "flex", gap: ".75rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <Link className="btn btn-outline" href={isAdmin ? "/admin" : "/mi-liga"}>Volver</Link>
          <form action="/salir" method="post"><button className="btn btn-outline" type="submit">Cerrar sesión</button></form>
        </div>
      </div>
    </main>
  );
}

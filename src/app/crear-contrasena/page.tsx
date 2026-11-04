import Image from "next/image";
import { redirect } from "next/navigation";
import { currentUser, hasPassword } from "@/lib/auth";
import { destinationAfterLogin } from "@/lib/afterLogin";
import { PasswordForm } from "./PasswordForm";
import s from "../acceso/acceso.module.css";

export const metadata = { title: "Crea tu contraseña · SAQUE LEAGUE" };

export default async function CrearContrasena({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/" } = await searchParams;
  const { sb, user } = await currentUser();
  if (!user) redirect("/acceso");
  if (hasPassword(user)) redirect(await destinationAfterLogin(sb, next));
  return (
    <main className={s.page}>
      <Image src="/brand/saque-navy.png" alt="Saque" width={140} height={56} style={{ width: 120, height: "auto" }} />
      <div className={s.card}>
        <h1 className="title">Crea tu contraseña</h1>
        <p className="muted">Ya has entrado con el enlace. Para los próximos accesos podrás usar <b>{user.email}</b> y esta contraseña, o seguir pidiendo el enlace.</p>
        <PasswordForm mode="create" next={next} />
      </div>
    </main>
  );
}

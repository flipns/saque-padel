"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

export async function sendMagicLink(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = String(form.get("next") ?? "/");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: "error", message: "Escribe un email válido." };

  // Solo se envían enlaces a emails inscritos (pareja o tutor) o de administración.
  const admin = supabaseAdmin();
  const [{ count: pairs }, { count: admins }] = await Promise.all([
    admin.from("pair_access").select("*", { count: "exact", head: true }).eq("email", email),
    admin.from("admins").select("*", { count: "exact", head: true }).eq("email", email),
  ]);
  const generic: LoginState = {
    status: "sent",
    message: "Si ese email está inscrito en la liga, te llegará un enlace para entrar. Revisa también la carpeta de spam.",
  };
  if (!pairs && !admins) return generic;

  const sb = await supabaseServer();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${site}/auth/callback?next=${encodeURIComponent(safeNext)}`, shouldCreateUser: true },
  });
  if (error) return { status: "error", message: "No se ha podido enviar el email. Inténtalo de nuevo en unos minutos." };
  return generic;
}

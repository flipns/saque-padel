import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "./supabase/server";

export const hasPassword = (u: User | null | undefined) => Boolean(u?.app_metadata?.has_password);

export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return { sb, user: data.user };
}

/** Sesión obligatoria y contraseña ya creada (la primera vez se entra con enlace y se crea contraseña). */
export async function requireUser(next: string) {
  const { sb, user } = await currentUser();
  if (!user) redirect(`/acceso?next=${encodeURIComponent(next)}`);
  if (!hasPassword(user)) redirect(`/crear-contrasena?next=${encodeURIComponent(next)}`);
  return { sb, user };
}

export async function requireAdmin(next = "/admin") {
  const { sb, user } = await requireUser(next);
  const { data } = await sb.rpc("is_admin");
  if (!data) redirect("/mi-liga");
  return { sb, user };
}

export interface MyPair { id: string }

/** Zona de jugador: devuelve las parejas a las que da acceso el email de la sesión. */
export async function requirePlayer(next = "/mi-liga") {
  const { sb, user } = await requireUser(next);
  const [{ data: access }, { data: isAdmin }] = await Promise.all([
    sb.from("pair_access").select("pair_id").eq("email", (user.email ?? "").toLowerCase()),
    sb.rpc("is_admin"),
  ]);
  return { sb, user, isAdmin: Boolean(isAdmin), pairIds: (access ?? []).map((a: any) => a.pair_id as string) };
}

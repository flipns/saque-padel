import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "./supabase/server";
import { loadBase } from "./data";

export const hasPassword = (u: User | null | undefined) => Boolean(u?.app_metadata?.has_password);

const isAdminFor = cache(async (sb: Awaited<ReturnType<typeof supabaseServer>>) => Boolean((await sb.rpc("is_admin")).data));

/**
 * Usuario de la petición. Se calcula una sola vez por petición, y mientras se verifica la sesión
 * se lanzan en paralelo las consultas que casi toda pantalla necesita (temporada, categorías, fases, ¿admin?).
 */
export const currentUser = cache(async () => {
  const sb = await supabaseServer();
  void loadBase(sb).catch(() => null);
  void isAdminFor(sb);
  const { data } = await sb.auth.getUser();
  return { sb, user: data.user };
});

/** Sesión obligatoria y contraseña ya creada (la primera vez se entra con enlace y se crea contraseña). */
export async function requireUser(next: string) {
  const { sb, user } = await currentUser();
  if (!user) redirect(`/acceso?next=${encodeURIComponent(next)}`);
  if (!hasPassword(user)) redirect(`/crear-contrasena?next=${encodeURIComponent(next)}`);
  return { sb, user };
}

export async function requireAdmin(next = "/admin") {
  const { sb, user } = await requireUser(next);
  if (!(await isAdminFor(sb))) redirect("/mi-liga");
  return { sb, user };
}

const accessFor = cache(async (sb: Awaited<ReturnType<typeof supabaseServer>>, email: string) => {
  const { data } = await sb.from("pair_access").select("pair_id").eq("email", email);
  return (data ?? []).map((a: any) => a.pair_id as string);
});

/** Zona de jugador: devuelve las parejas a las que da acceso el email de la sesión. */
export async function requirePlayer(next = "/mi-liga") {
  const { sb, user } = await requireUser(next);
  const [pairIds, isAdmin] = await Promise.all([accessFor(sb, (user.email ?? "").toLowerCase()), isAdminFor(sb)]);
  return { sb, user, isAdmin, pairIds };
}

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "./supabase/server";
import { loadBase } from "./data";
import { claimsFromToken } from "./jwt";
import { memoFor } from "./memo";

export const hasPassword = (u: User | null | undefined) => Boolean(u?.app_metadata?.has_password);

const isAdminFor = (sb: Awaited<ReturnType<typeof supabaseServer>>) => memoFor(sb, "is_admin", async () => Boolean((await sb.rpc("is_admin")).data));

/** Parejas a las que da acceso un email, con la categoría de cada una (una sola consulta). */
const accessFor = (sb: Awaited<ReturnType<typeof supabaseServer>>, email: string) => memoFor(sb, `access:${email}`, async () => {
  const { data } = await sb.from("pair_access").select("pair_id, pairs(category_id)").eq("email", email);
  const rows = (data ?? []) as any[];
  const pairCats: Record<string, string> = {};
  for (const a of rows) { const p = Array.isArray(a.pairs) ? a.pairs[0] : a.pairs; if (p?.category_id) pairCats[a.pair_id] = p.category_id; }
  return { pairIds: rows.map((a) => a.pair_id as string), pairCats };
});

/**
 * Usuario de la petición. Se calcula una sola vez por petición, y mientras se verifica la sesión
 * se lanzan en paralelo las consultas que casi toda pantalla necesita (temporada, categorías, fases, ¿admin?).
 */
export const currentUser = cache(async () => {
  const sb = await supabaseServer();
  void loadBase(sb).catch(() => null);
  void isAdminFor(sb);
  // Mientras se verifica la sesión contra Auth, ya se pide lo que depende del email (no cambia de resultado: es el mismo email).
  const { data: s } = await sb.auth.getSession();
  const early = claimsFromToken(s.session?.access_token)?.email?.toLowerCase();
  if (early) void accessFor(sb, early).catch(() => null);
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



/** Zona de jugador: devuelve las parejas a las que da acceso el email de la sesión. */
export async function requirePlayer(next = "/mi-liga") {
  const { sb, user } = await requireUser(next);
  const [access, isAdmin] = await Promise.all([accessFor(sb, (user.email ?? "").toLowerCase()), isAdminFor(sb)]);
  return { sb, user, isAdmin, pairIds: access.pairIds, pairCats: access.pairCats };
}

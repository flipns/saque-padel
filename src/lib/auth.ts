import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return { sb, user: data.user };
}

export async function requireAdmin() {
  const { sb, user } = await currentUser();
  if (!user) redirect("/acceso?next=/admin");
  const { data } = await sb.rpc("is_admin");
  if (!data) redirect("/?aviso=sin-permiso");
  return { sb, user };
}

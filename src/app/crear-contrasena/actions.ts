"use server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { destinationAfterLogin } from "@/lib/afterLogin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PwState = { status: "idle" | "ok" | "error"; message?: string };

async function save(form: FormData) {
  const { sb, user } = await currentUser();
  if (!user) redirect("/acceso");
  const password = String(form.get("password") ?? "");
  const repeat = String(form.get("repeat") ?? "");
  if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres.", sb, user };
  if (password !== repeat) return { error: "Las dos contraseñas no coinciden.", sb, user };
  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    console.error("updateUser(password) failed", error);
    return { error: /different|same/i.test(error.message) ? "Elige una contraseña distinta de la anterior." : "No se ha podido guardar la contraseña. Inténtalo de nuevo.", sb, user };
  }
  // Marca de servidor (no editable por el usuario): ya tiene contraseña.
  const { error: e2 } = await supabaseAdmin().auth.admin.updateUserById(user.id, { app_metadata: { has_password: true } });
  if (e2) {
    console.error("set has_password failed", e2);
    return { error: "No se ha podido completar el registro. Avisa a la organización.", sb, user };
  }
  return { error: null, sb, user };
}

/** Primer acceso: crea la contraseña y entra en la liga. */
export async function createPassword(_: PwState, form: FormData): Promise<PwState> {
  const r = await save(form);
  if (r.error) return { status: "error", message: r.error };
  redirect(await destinationAfterLogin(r.sb, String(form.get("next") ?? "/")));
}

/** Cambio de contraseña desde «Mi cuenta». */
export async function changePassword(_: PwState, form: FormData): Promise<PwState> {
  const r = await save(form);
  if (r.error) return { status: "error", message: r.error };
  return { status: "ok", message: "Contraseña actualizada." };
}

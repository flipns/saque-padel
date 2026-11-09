import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { FLASH_COOKIE, type FlashPayload } from "@/components/Flash";
import { after } from "next/server";
import { flushEmails } from "@/lib/email";

/** Vuelve a una página con un mensaje (ok o error). Se muestra con <Flash />. */
export function back(path: string, kind: "ok" | "err", msg: string): never {
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  redirect(`${base}${sep}${kind}=${encodeURIComponent(msg)}${hash ? `#${hash}` : ""}`);
}

/** Ruta de la pantalla desde la que se envió el formulario, si coincide con `path`; null si es otra (o no se sabe). */
async function samePage(path: string): Promise<string | null> {
  const target = path.split("#")[0].split("?")[0];
  try {
    const ref = (await headers()).get("referer");
    return ref && new URL(ref).pathname === target ? target : null;
  } catch { return null; }
}

/**
 * Ejecuta una acción de servidor y muestra el resultado.
 * `fn` devuelve el mensaje de éxito o lanza un Error con el motivo. No debe llamar a redirect().
 *
 * Si el botón se pulsó en la misma pantalla a la que se vuelve (lo habitual), NO se redirige: la acción guarda,
 * deja el mensaje en una cookie de 30 segundos y marca la pantalla para refrescar; Next devuelve la pantalla
 * actualizada en la propia respuesta, una sola vez (con la redirección se calculaba dos veces seguidas).
 * Si el destino es otra pantalla (p. ej. al crear una pareja), se redirige con ?ok= / ?err= como siempre.
 */
export async function run(path: string, fn: () => Promise<string>): Promise<void> {
  let kind: "ok" | "err" = "ok", msg: string;
  try {
    msg = await fn();
  } catch (e: any) {
    console.error("action failed:", e);
    kind = "err";
    msg = e?.message ?? "Ha ocurrido un error";
  }
  // Tras guardar, envía por email los avisos que haya generado la acción (sin retrasar la respuesta).
  if (kind === "ok") after(async () => { try { await flushEmails({ limit: 50 }); } catch (e) { console.error("flushEmails failed", e); } });

  const stay = await samePage(path);
  if (!stay) return back(path, kind, msg);
  const payload: FlashPayload = { id: crypto.randomUUID(), k: kind, m: msg.slice(0, 500) };
  (await cookies()).set(FLASH_COOKIE, JSON.stringify(payload), { path: "/", maxAge: 30, sameSite: "lax", httpOnly: false });
  revalidatePath(stay);
}

/** Lanza un Error si la respuesta de Supabase trae error; si no, devuelve los datos. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

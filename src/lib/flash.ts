import { redirect } from "next/navigation";
import { after } from "next/server";
import { flushEmails } from "@/lib/email";

/** Vuelve a una página con un mensaje (ok o error). Se muestra con <Flash />. */
export function back(path: string, kind: "ok" | "err", msg: string): never {
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  redirect(`${base}${sep}${kind}=${encodeURIComponent(msg)}${hash ? `#${hash}` : ""}`);
}

/**
 * Ejecuta una acción de servidor y vuelve a `path` con el resultado.
 * `fn` devuelve el mensaje de éxito o lanza un Error con el motivo. No debe llamar a redirect().
 */
export async function run(path: string, fn: () => Promise<string>): Promise<never> {
  let msg: string;
  try {
    msg = await fn();
  } catch (e: any) {
    console.error("action failed:", e);
    return back(path, "err", e?.message ?? "Ha ocurrido un error");
  }
  // Tras guardar, envía por email los avisos que haya generado la acción (sin retrasar la respuesta).
  after(async () => { try { await flushEmails({ limit: 50 }); } catch (e) { console.error("flushEmails failed", e); } });
  return back(path, "ok", msg);
}

/** Lanza un Error si la respuesta de Supabase trae error; si no, devuelve los datos. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

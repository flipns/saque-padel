import { cookies } from "next/headers";
import { FlashToast } from "./FlashToast";

export const FLASH_COOKIE = "flash";
export interface FlashPayload { id: string; k: "ok" | "err"; m: string }

/**
 * Mensaje tras guardar. Viene de la cookie que deja la acción (la pantalla se refresca sin recargarse) o, en las
 * redirecciones entre pantallas y los enlaces de acceso, de ?ok= / ?err= en la dirección.
 */
export async function Flash({ ok, err }: { ok?: string; err?: string }) {
  let fromCookie: FlashPayload | null = null;
  try {
    const raw = (await cookies()).get(FLASH_COOKIE)?.value;
    if (raw) { const p = JSON.parse(raw) as FlashPayload; if (p && (p.k === "ok" || p.k === "err") && typeof p.m === "string") fromCookie = p; }
  } catch { /* cookie no válida: se ignora */ }
  if (fromCookie) return <FlashToast key={fromCookie.id} id={fromCookie.id} kind={fromCookie.k} msg={fromCookie.m} />;
  const kind = err ? "err" : ok ? "ok" : null;
  const msg = err ?? ok;
  if (!kind || !msg) return null;
  return <FlashToast key={`${kind}:${msg}`} id={`${kind}:${msg}`} kind={kind} msg={msg} />;
}

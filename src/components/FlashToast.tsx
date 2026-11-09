"use client";
import { useEffect, useState } from "react";

/**
 * Aviso flotante de confirmación o error. Se ve aunque estés abajo del todo de la pantalla (al guardar ya no recargamos
 * la página arriba), se cierra solo y borra la cookie que lo trajo para que no vuelva a salir.
 */
export function FlashToast({ id, kind, msg }: { id: string; kind: "ok" | "err"; msg: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    document.cookie = "flash=; Max-Age=0; path=/";
    // Si el aviso llegó por ?ok= / ?err= (redirecciones entre pantallas), se quita de la dirección para que no reaparezca al recargar.
    const u = new URL(window.location.href);
    if (u.searchParams.has("ok") || u.searchParams.has("err")) {
      u.searchParams.delete("ok"); u.searchParams.delete("err");
      window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    }
    window.dispatchEvent(new Event("flash:shown"));
    const t = window.setTimeout(() => setOpen(false), kind === "ok" ? 7000 : 15000);
    return () => window.clearTimeout(t);
  }, [id, kind]);
  if (!open) return null;
  return (
    <div className="toast">
      <p role={kind === "err" ? "alert" : "status"} className={`flash flash-${kind}`}>{msg}</p>
      <button type="button" className="toast-x" aria-label="Cerrar el aviso" onClick={() => setOpen(false)}>×</button>
    </div>
  );
}

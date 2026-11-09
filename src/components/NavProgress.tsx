"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Barra fina de progreso arriba del todo: aparece al instante al pulsar un enlace o un botón que guarda algo,
 * y desaparece cuando la página nueva está lista. Así nunca hay un momento en que «parece que no pasa nada».
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  const startedAt = useRef(0);
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  function start() {
    clear();
    startedAt.current = Date.now();
    setPhase("run");
    timers.current.push(window.setTimeout(finish, 12000));   // por si algo no responde, la barra no se queda colgada
  }
  function finish() {
    clear();
    setPhase((p) => (p === "run" ? "done" : p));
    timers.current.push(window.setTimeout(() => setPhase("idle"), 400));
  }

  // La navegación terminó: cambió la dirección o el contenido principal.
  useEffect(() => { if (phase === "run" && Date.now() - startedAt.current > 50) finish(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pathname, search]);
  useEffect(() => {
    if (phase !== "run") return;
    const main = document.querySelector("main");
    if (!main) return;
    const mo = new MutationObserver(() => { if (Date.now() - startedAt.current > 250) finish(); });
    mo.observe(main, { childList: true, subtree: true });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;   // solo cambia el ancla: no hay carga
      start();
    };
    const onSubmit = (e: SubmitEvent) => { if (!e.defaultPrevented) start(); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit, true); clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "idle") return null;
  return <div className={`navprogress ${phase}`} role="progressbar" aria-label="Cargando" aria-busy="true" />;
}

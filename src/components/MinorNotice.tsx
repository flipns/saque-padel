"use client";
import { useEffect, useState } from "react";

const KEY = "saque-minor-notice-v1";

/** Aviso para menores. Se muestra hasta que la persona pulsa «Entendido» (se recuerda en ese dispositivo). */
export function MinorNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(localStorage.getItem(KEY) !== "ok"); } catch { setShow(true); } }, []);
  if (!show) return null;
  return (
    <div role="note" className="notice-minor">
      <span><b>Si eres menor de edad,</b> participas en la liga bajo la autorización de tu tutor, padre o madre.</span>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => { try { localStorage.setItem(KEY, "ok"); } catch {} setShow(false); }}>Entendido</button>
    </div>
  );
}

"use client";
import { useActionState, useEffect, useState } from "react";
import { passwordLogin, sendMagicLink, type LoginState } from "./actions";

type Mode = "link" | "password";
const KEY = "saque-login-mode";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("link");
  const [email, setEmail] = useState("");
  const [linkState, linkAction, linkPending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });
  const [pwState, pwAction, pwPending] = useActionState<LoginState, FormData>(passwordLogin, { status: "idle" });

  // Recuerda el método usado la última vez en este dispositivo.
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved === "password" || saved === "link") setMode(saved);
  }, []);
  const choose = (m: Mode) => { setMode(m); try { localStorage.setItem(KEY, m); } catch {} };

  return (
    <div>
      <div role="tablist" aria-label="Método de acceso" className="seg">
        <button role="tab" type="button" aria-selected={mode === "link"} onClick={() => choose("link")}>Enlace por email</button>
        <button role="tab" type="button" aria-selected={mode === "password"} onClick={() => choose("password")}>Contraseña</button>
      </div>

      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required form={mode === "link" ? "f-link" : "f-pw"}
        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="El que pusiste en la inscripción" />

      {mode === "link" ? (
        <form id="f-link" action={linkAction} noValidate>
          <input type="hidden" name="next" value={next} />
          {linkState.status === "sent" ? (
            <p role="status" className="notice">{linkState.message}</p>
          ) : (
            <>
              {linkState.status === "error" && <p role="alert" className="error">{linkState.message}</p>}
              <p className="help">Si es tu primera vez, entra con el enlace: después te pediremos que crees una contraseña para los próximos accesos.</p>
              <button className="btn btn-navy block" type="submit" disabled={linkPending}>{linkPending ? "Enviando…" : "Enviarme el enlace"}</button>
            </>
          )}
        </form>
      ) : (
        <form id="f-pw" action={pwAction} noValidate>
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password" style={{ marginTop: "1rem" }}>Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {pwState.status === "error" && <p role="alert" className="error">{pwState.message}</p>}
          <button className="btn btn-navy block" type="submit" disabled={pwPending} style={{ marginTop: "1rem" }}>{pwPending ? "Entrando…" : "Entrar"}</button>
          <button type="button" className="linklike" onClick={() => choose("link")}>He olvidado la contraseña o es mi primera vez</button>
        </form>
      )}
    </div>
  );
}

"use client";
import { useActionState } from "react";
import { createPassword, changePassword, type PwState } from "./actions";

export function PasswordForm({ mode, next = "/" }: { mode: "create" | "change"; next?: string }) {
  const [state, action, pending] = useActionState<PwState, FormData>(mode === "create" ? createPassword : changePassword, { status: "idle" });
  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password">{mode === "create" ? "Contraseña" : "Nueva contraseña"}</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      <label htmlFor="repeat" style={{ marginTop: "1rem" }}>Repite la contraseña</label>
      <input id="repeat" name="repeat" type="password" autoComplete="new-password" minLength={8} required />
      <p className="help">Mínimo 8 caracteres.</p>
      {state.status === "error" && <p role="alert" className="error">{state.message}</p>}
      {state.status === "ok" && <p role="status" className="okmsg">{state.message}</p>}
      <button className="btn btn-navy block" type="submit" disabled={pending}>
        {pending ? "Guardando…" : mode === "create" ? "Guardar y entrar" : "Cambiar contraseña"}
      </button>
    </form>
  );
}

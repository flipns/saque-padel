"use client";
import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });
  if (state.status === "sent") return <p role="status" className="notice">{state.message}</p>;
  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required placeholder="El que pusiste en la inscripción" />
      {state.status === "error" && <p role="alert" className="error">{state.message}</p>}
      <button className="btn btn-navy" type="submit" disabled={pending} style={{ marginTop: "1rem", width: "100%" }}>
        {pending ? "Enviando…" : "Enviarme el enlace"}
      </button>
    </form>
  );
}

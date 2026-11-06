"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { sendChatAction, markChatReadAction } from "../chat-actions";
import type { ChatMessage } from "@/lib/chat";

const TZ = "Europe/Madrid";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dayOf = (iso: string) => { const l = new Date(iso).toLocaleDateString("es-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }); return l.charAt(0).toUpperCase() + l.slice(1); };
const signature = (m: ChatMessage[]) => m.map((x) => `${x.id}${x.deleted ? "x" : ""}`).join("|");
const POLL_MS = 5000;

/** Chat de los cuatro jugadores de un partido. Se refresca solo mientras la pestaña está visible. */
export function Chat({ matchId, initial, myPairId, canWrite, closedNote, identity }: {
  matchId: string; initial: ChatMessage[]; myPairId: string; canWrite: boolean; closedNote?: string; identity?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastSig = useRef(signature(initial));

  const markRead = useCallback(() => { if (document.visibilityState === "visible") void markChatReadAction(matchId).catch(() => {}); }, [matchId]);

  // Al entrar: bajar al último mensaje y marcar como leído.
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; markRead(); }, [markRead]);

  // Refresco periódico.
  useEffect(() => {
    let stop = false;
    async function poll() {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/chat/${matchId}`, { cache: "no-store" });
        if (!r.ok) return;
        const { messages: next } = (await r.json()) as { messages: ChatMessage[] };
        const sig = signature(next);
        if (sig !== lastSig.current) { lastSig.current = sig; setMessages(next); markRead(); }
      } catch { /* sin red: se reintenta en el siguiente ciclo */ }
    }
    const id = setInterval(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [matchId, markRead]);

  // Bajar al final si ya estabas abajo o si el último mensaje es tuyo.
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    if (stick.current || messages[messages.length - 1]?.is_mine) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function send() {
    const body = text.trim();
    if (!body || pending) return;
    setError(null);
    start(async () => {
      const r = await sendChatAction(matchId, body);
      if (!r.ok) { setError(r.error ?? "No se ha podido enviar."); return; }
      setText("");
      if (r.messages) { lastSig.current = signature(r.messages); setMessages(r.messages); }
    });
  }

  let prevDay = "";
  return (
    <div className="chat">
      <div ref={listRef} className="chat-list" role="log" aria-live="polite" aria-label="Mensajes del chat"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {messages.length === 0 && <p className="chat-empty">Todavía no hay mensajes. Escribid para acordar el día y la hora.</p>}
        {messages.map((m) => {
          const d = dayOf(m.created_at);
          const sep = d !== prevDay ? <div className="chat-day" key={`d-${m.id}`}>{d}</div> : null;
          prevDay = d;
          if (m.kind === "SYSTEM") return <div key={m.id}>{sep}<div className="msg sys">{m.body}<time> · {hm(m.created_at)}</time></div></div>;
          const mate = !m.is_mine && m.author_pair === myPairId;
          const cls = m.kind === "ORG" ? "org" : m.is_mine ? "me" : mate ? "mate" : "rival";
          return (
            <div key={m.id}>{sep}
              <div className={`msg ${cls}${m.deleted ? " deleted" : ""}`}>
                {!m.is_mine && <b className="who">{m.kind === "ORG" ? "Organización" : m.author_name}{mate ? " (tu pareja)" : ""}</b>}
                <span className="txt">{m.deleted ? "Mensaje eliminado por la organización" : m.body}</span>
                <time>{hm(m.created_at)}</time>
              </div>
            </div>
          );
        })}
      </div>

      {identity ? identity : canWrite ? (
        <div className="chat-form">
          <label htmlFor="chat-text" className="sr-only">Escribe un mensaje</label>
          <textarea id="chat-text" rows={2} maxLength={1000} value={text} placeholder="Escribe un mensaje…" disabled={pending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <button type="button" className="btn btn-navy" onClick={send} disabled={pending || !text.trim()}>{pending ? "Enviando…" : "Enviar"}</button>
        </div>
      ) : <p className="chat-closed">{closedNote ?? "El chat está cerrado."}</p>}
      {error && <p role="alert" className="error" style={{ margin: ".5rem 0 0" }}>{error}</p>}
    </div>
  );
}

"use client";
import { useMemo, useState, useTransition } from "react";
import { WEEKDAYS, addDays, fmtMin, isoWeekday, normalizeExceptions, validateExceptions, type Exception, type Slot } from "@/lib/availability";
import { saveExceptionsAction } from "./actions";

const START_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30);
const END_OPTIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 30);
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKS = 6;

const longDate = (d: string) => { const [y, m, day] = d.split("-").map(Number); return `${WEEKDAYS[isoWeekday(d) - 1]} ${day} de ${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][m - 1]}`; };
const short = (d: string) => { const [, m, day] = d.split("-").map(Number); return `${day} ${MONTHS[m - 1]}`; };

/** Calendario por fechas: bloqueos (vacaciones, lesión…), disponibilidad extra, copiar semanas y bloquear rangos. */
export function ExceptionsEditor({ playerId, playerName, initial, weekly, today }: { playerId: string; playerName: string; initial: Exception[]; weekly: Slot[]; today: string }) {
  const [items, setItems] = useState<Exception[]>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(""), [to, setTo] = useState("");

  const weekStart = addDays(today, -(isoWeekday(today) - 1));
  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(weekStart, w * 7 + d))), [weekStart]);
  const change = (next: Exception[]) => { setItems(next); setDirty(true); setMsg(null); };
  const ofDate = (d: string) => items.map((e, i) => ({ e, i })).filter((x) => x.e.date === d);
  const whole = (e: Exception) => e.startMin === 0 && e.endMin === 1440;
  const stateOf = (d: string) => {
    const l = items.filter((e) => e.date === d);
    if (l.some((e) => e.status === "UNAVAILABLE" && whole(e))) return "blocked";
    if (l.some((e) => e.status === "UNAVAILABLE")) return "partial";
    if (l.some((e) => e.status === "AVAILABLE")) return "extra";
    return "";
  };
  const add = (date: string, status: Exception["status"], startMin: number, endMin: number) => change([...items, { date, startMin, endMin, status, preferred: false }]);
  const patch = (i: number, p: Partial<Exception>) => change(items.map((e, k) => {
    if (k !== i) return e;
    const n = { ...e, ...p };
    if (n.endMin <= n.startMin) n.endMin = Math.min(n.startMin + 60, 1440);
    if (n.status === "UNAVAILABLE") n.preferred = false;
    return n;
  }));
  const clearWeek = (w: number) => change(items.filter((e) => !weeks[w].includes(e.date)));
  const blockWeek = (w: number) => change([...items.filter((e) => !weeks[w].includes(e.date) || e.status !== "UNAVAILABLE" || !whole(e)), ...weeks[w].filter((d) => d >= today).map((date): Exception => ({ date, startMin: 0, endMin: 1440, status: "UNAVAILABLE" }))]);
  function copyWeek(from: number, target: number) {
    if (from === target) return;
    if (!window.confirm(`Se copian las excepciones de la semana del ${short(weeks[from][0])} a la del ${short(weeks[target][0])}, sustituyendo las que hubiera. ¿Continuar?`)) return;
    const copies = items.filter((e) => weeks[from].includes(e.date)).map((e) => ({ ...e, date: weeks[target][weeks[from].indexOf(e.date)] })).filter((e) => e.date >= today);
    change([...items.filter((e) => !weeks[target].includes(e.date)), ...copies]);
  }
  function blockRange() {
    if (!from || !to || to < from) { setMsg({ ok: false, text: "Elige un día de inicio y otro de fin (el fin no puede ser anterior)." }); return; }
    const days: string[] = [];
    for (let d = from < today ? today : from; d <= to && days.length <= 120; d = addDays(d, 1)) days.push(d);
    change([...items.filter((e) => !(days.includes(e.date) && e.status === "UNAVAILABLE" && whole(e))), ...days.map((date): Exception => ({ date, startMin: 0, endMin: 1440, status: "UNAVAILABLE" }))]);
    setFrom(""); setTo("");
  }
  function save() {
    const bad = validateExceptions(items, today);
    if (bad) { setMsg({ ok: false, text: bad }); return; }
    start(async () => {
      const r = await saveExceptionsAction(playerId, items);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? "No se ha podido guardar." }); return; }
      setItems(r.items ?? normalizeExceptions(items)); setDirty(false);
      setMsg({ ok: true, text: `Guardado: ${(r.items ?? []).length} ${(r.items ?? []).length === 1 ? "excepción" : "excepciones"}.` });
    });
  }
  const weeklyOf = (d: string) => weekly.filter((s) => s.weekday === isoWeekday(d)).sort((a, b) => a.startMin - b.startMin).map((s) => `${fmtMin(s.startMin)}–${fmtMin(s.endMin)}${s.preferred ? "★" : ""}`).join(", ");

  return (
    <div>
      <p className="subtle" style={{ margin: "0 0 .5rem" }}>Toca un día para añadir un <b>bloqueo</b> (vacaciones, lesión, festivo…) o <b>disponibilidad extra</b>. Un bloqueo prevalece siempre sobre tu semana tipo. <span style={{ color: "var(--danger)", fontWeight: 800 }}>Rojo</span>: día bloqueado · <span style={{ color: "#7a4b00", fontWeight: 800 }}>naranja</span>: bloqueo parcial · <span style={{ color: "var(--ok)", fontWeight: 800 }}>verde</span>: extra.</p>

      <div className="daycal" role="group" aria-label="Calendario">
        <div className="weekrow" aria-hidden>{WEEKDAYS.map((d) => <small key={d} className="subtle" style={{ textAlign: "center", fontWeight: 800 }}>{d.slice(0, 3)}</small>)}</div>
        {weeks.map((w, wi) => (
          <div key={wi}>
            <div className="weekhead">
              <b>Semana del {short(w[0])}</b>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => blockWeek(wi)}>Bloquear semana</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => clearWeek(wi)}>Vaciar</button>
              <label className="sr-only" htmlFor={`cp${wi}`}>Copiar esta semana a</label>
              <select id={`cp${wi}`} value="" onChange={(e) => { if (e.target.value !== "") copyWeek(wi, Number(e.target.value)); }}>
                <option value="">Copiar a…</option>
                {weeks.map((x, k) => k !== wi && <option key={k} value={k}>Semana del {short(x[0])}</option>)}
              </select>
            </div>
            <div className="weekrow">
              {w.map((d) => (
                <button key={d} type="button" className={`daycell ${stateOf(d)}${sel === d ? " sel" : ""}${d < today ? " past" : ""}`} disabled={d < today} onClick={() => setSel(sel === d ? null : d)}
                  aria-label={`${longDate(d)}${stateOf(d) === "blocked" ? ", bloqueado" : stateOf(d) === "partial" ? ", bloqueo parcial" : stateOf(d) === "extra" ? ", con disponibilidad extra" : ""}`} aria-pressed={sel === d}>
                  <span>{Number(d.slice(8))}</span><small>{d.endsWith("-01") || d === w[0] ? MONTHS[Number(d.slice(5, 7)) - 1] : stateOf(d) === "blocked" ? "✕" : stateOf(d) === "partial" ? "◐" : stateOf(d) === "extra" ? "+" : "\u00a0"}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ background: "var(--mist)", border: 0, marginBottom: "1rem" }}>
        <b style={{ fontSize: ".95rem" }}>Bloquear un periodo (vacaciones, viaje, lesión)</b>
        <div className="exline" style={{ marginTop: ".5rem" }}>
          <label htmlFor="r-from">Del</label><input id="r-from" type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} />
          <label htmlFor="r-to">al</label><input id="r-to" type="date" value={to} min={from || today} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} />
          <button type="button" className="btn btn-outline btn-sm" onClick={blockRange}>Bloquear esos días</button>
        </div>
      </div>

      {sel && (
        <section className="card" aria-label={`Excepciones de ${longDate(sel)}`}>
          <h3 style={{ fontSize: "1.05rem" }}>{longDate(sel)}</h3>
          <p className="subtle" style={{ margin: ".2rem 0 .6rem" }}>Tu semana tipo ese día: {weeklyOf(sel) || "sin franjas"}.</p>
          {ofDate(sel).map(({ e, i }) => (
            <div className="exrow" key={i}>
              <div className="exline">
                <label className="sr-only" htmlFor={`st${i}`}>Tipo</label>
                <select id={`st${i}`} value={e.status} onChange={(ev) => patch(i, { status: ev.target.value as Exception["status"] })}>
                  <option value="UNAVAILABLE">No puedo</option><option value="AVAILABLE">Puedo (extra)</option>
                </select>
                <label className="sr-only" htmlFor={`a${i}`}>Desde</label>
                <select id={`a${i}`} value={e.startMin} onChange={(ev) => patch(i, { startMin: Number(ev.target.value) })}>{START_OPTIONS.map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}</select>
                <span>a</span>
                <label className="sr-only" htmlFor={`b${i}`}>Hasta</label>
                <select id={`b${i}`} value={e.endMin} onChange={(ev) => patch(i, { endMin: Number(ev.target.value) })}>{END_OPTIONS.filter((m) => m > e.startMin).map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}</select>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => change(items.filter((_, k) => k !== i))} aria-label="Quitar esta excepción">Quitar</button>
              </div>
              <div className="exline">
                {e.status === "AVAILABLE"
                  ? <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={Boolean(e.preferred)} onChange={(ev) => patch(i, { preferred: ev.target.checked })} /> ★ Preferente</label>
                  : <><label className="sr-only" htmlFor={`n${i}`}>Nota privada</label><input id={`n${i}`} type="text" maxLength={80} placeholder="Nota privada (opcional, no la ve nadie del otro lado)" value={e.note ?? ""} onChange={(ev) => patch(i, { note: ev.target.value })} /></>}
              </div>
            </div>
          ))}
          <div className="actions" style={{ marginTop: ".75rem" }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => add(sel, "UNAVAILABLE", 0, 1440)}>No puedo en todo el día</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => add(sel, "UNAVAILABLE", 18 * 60, 22 * 60)}>No puedo en un horario</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => add(sel, "AVAILABLE", 18 * 60, 22 * 60)}>Puedo en un horario extra</button>
          </div>
        </section>
      )}

      <div className="avsave">
        <button type="button" className="btn btn-navy" onClick={save} disabled={pending || !dirty}>{pending ? "Guardando…" : `Guardar excepciones de ${playerName.split(" ")[0]}`}</button>
        {dirty && !pending && <span className="subtle">Hay cambios sin guardar.</span>}
        {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "okmsg" : "error"} style={{ margin: 0 }}>{msg.text}</span>}
      </div>
    </div>
  );
}

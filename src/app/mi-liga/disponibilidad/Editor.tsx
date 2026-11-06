"use client";
import { useState, useTransition } from "react";
import { WEEKDAYS, fmtMin, normalizeSlots, validateSlots, type Slot } from "@/lib/availability";
import { saveAvailabilityAction } from "./actions";

const START_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30);          // 00:00 … 23:30
const END_OPTIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 30);      // 00:30 … 24:00

/** Editor de la semana tipo: franjas en las que el jugador PUEDE jugar, con «preferente» opcional. */
export function Editor({ playerId, playerName, initial }: { playerId: string; playerName: string; initial: Slot[] }) {
  const [slots, setSlots] = useState<Slot[]>(normalizeSlots(initial));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  const change = (next: Slot[]) => { setSlots(next); setDirty(true); setMsg(null); };
  const ofDay = (wd: number) => slots.map((s, i) => ({ s, i })).filter((x) => x.s.weekday === wd).sort((a, b) => a.s.startMin - b.s.startMin);

  function add(wd: number) {
    const day = ofDay(wd);
    const last = day[day.length - 1]?.s;
    const startMin = last ? Math.min(last.endMin + 30, 1380) : 18 * 60;
    change([...slots, { weekday: wd, startMin, endMin: Math.min(startMin + 120, 1440), preferred: false }]);
  }
  function update(i: number, patch: Partial<Slot>) {
    change(slots.map((s, k) => {
      if (k !== i) return s;
      const n = { ...s, ...patch };
      if (n.endMin <= n.startMin) n.endMin = Math.min(n.startMin + 60, 1440);
      return n;
    }));
  }
  const preset = (days: number[], from: number, to: number) => change(normalizeSlots([...slots, ...days.map((weekday) => ({ weekday, startMin: from, endMin: to, preferred: false }))]));

  function save() {
    const bad = validateSlots(slots);
    if (bad) { setMsg({ ok: false, text: bad }); return; }
    start(async () => {
      const r = await saveAvailabilityAction(playerId, slots);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? "No se ha podido guardar." }); return; }
      setSlots(r.slots ?? slots); setDirty(false);
      setMsg({ ok: true, text: r.slots && r.slots.length ? `Guardado: ${r.slots.length} ${r.slots.length === 1 ? "franja" : "franjas"} a la semana.` : "Guardado: sin ninguna franja (no se sugerirán horarios)." });
    });
  }

  return (
    <div>
      <div className="avpresets" role="group" aria-label="Atajos">
        <button type="button" className="chip" onClick={() => preset([1, 2, 3, 4, 5], 18 * 60, 22 * 60)}>+ Tardes entre semana (18:00–22:00)</button>
        <button type="button" className="chip" onClick={() => preset([6, 7], 10 * 60, 14 * 60)}>+ Fin de semana por la mañana (10:00–14:00)</button>
        <button type="button" className="chip" onClick={() => preset([6, 7], 10 * 60, 22 * 60)}>+ Fin de semana todo el día</button>
        <button type="button" className="chip" onClick={() => change([])}>Borrar todo</button>
      </div>
      <p className="subtle" style={{ margin: "0 0 .75rem" }}>Marca ★ <b>preferente</b> en las franjas que más te convienen: el sistema recomienda antes los horarios que prefieren varios jugadores. Una preferente puede ir dentro de una normal (p. ej. 18:00–22:00 y 19:00–21:00 ★).</p>

      <div className="avdays">
        {WEEKDAYS.map((name, idx) => {
          const wd = idx + 1, day = ofDay(wd);
          return (
            <section key={wd} className="avday" aria-label={name}>
              <div className="avhead"><h3>{name}</h3><button type="button" className="btn btn-outline btn-sm" onClick={() => add(wd)} disabled={day.length >= 8}>+ Añadir franja</button></div>
              <div className="avbar" aria-hidden>{day.map(({ s, i }) => <i key={i} className={s.preferred ? "pref" : ""} style={{ left: `${(s.startMin / 1440) * 100}%`, width: `${((s.endMin - s.startMin) / 1440) * 100}%` }} />)}</div>
              <div className="avticks" aria-hidden><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
              {day.length === 0 ? <p className="subtle" style={{ margin: ".4rem 0 0" }}>Sin información (no se considera libre).</p> : day.map(({ s, i }) => (
                <div key={i}>
                  <div className="avrow">
                    <label className="sr-only" htmlFor={`f${i}`}>Desde</label>
                    <select id={`f${i}`} value={s.startMin} onChange={(e) => update(i, { startMin: Number(e.target.value) })}>{START_OPTIONS.map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}</select>
                    <span>a</span>
                    <label className="sr-only" htmlFor={`t${i}`}>Hasta</label>
                    <select id={`t${i}`} value={s.endMin} onChange={(e) => update(i, { endMin: Number(e.target.value) })}>{END_OPTIONS.filter((m) => m > s.startMin).map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}</select>
                  </div>
                  <div className="avrow2">
                    <label className="check"><input type="checkbox" checked={Boolean(s.preferred)} onChange={(e) => update(i, { preferred: e.target.checked })} /> ★ Preferente</label>
                    <button type="button" className="btn btn-outline btn-sm" aria-label={`Quitar la franja de ${name}`} onClick={() => change(slots.filter((_, k) => k !== i))}>Quitar</button>
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>

      <div className="avsave">
        <button type="button" className="btn btn-navy" onClick={save} disabled={pending || !dirty}>{pending ? "Guardando…" : `Guardar disponibilidad de ${playerName.split(" ")[0]}`}</button>
        {dirty && !pending && <span className="subtle">Hay cambios sin guardar.</span>}
        {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "okmsg" : "error"} style={{ margin: 0 }}>{msg.text}</span>}
      </div>
    </div>
  );
}

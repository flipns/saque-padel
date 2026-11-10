"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { WEEKDAYS, addDays, fmtMin, isoWeekday, normalizeExceptions, normalizeSlots, validateExceptions, validateSlots, type Exception, type Slot } from "@/lib/availability";
import { saveAvailabilityAction, saveExceptionsAction } from "./actions";

/** Horas de un día de la semana habitual, para el detalle de un día del calendario. */
const summary = (slots: Slot[], wd: number) =>
  normalizeSlots(slots.filter((s) => s.weekday === wd).map((s) => ({ ...s, preferred: false }))).map((s) => `${fmtMin(s.startMin)}–${fmtMin(s.endMin)}`).join(" · ");

const START_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30);
const END_OPTIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 30);
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKS = 6;
const longDate = (d: string) => { const [, m, day] = d.split("-").map(Number); return `${WEEKDAYS[isoWeekday(d) - 1]} ${day} de ${MONTHS_LONG[m - 1]}`; };
const short = (d: string) => { const [, m, day] = d.split("-").map(Number); return `${day} ${MONTHS[m - 1]}`; };
const whole = (e: Exception) => e.startMin === 0 && e.endMin === 1440;

export function AvailabilityEditor({ playerId, playerName, initialSlots, initialExceptions, today }: {
  playerId: string; playerName: string; initialSlots: Slot[]; initialExceptions: Exception[]; today: string;
}) {
  const [slots, setSlots] = useState<Slot[]>(normalizeSlots(initialSlots));
  const [items, setItems] = useState<Exception[]>(initialExceptions);
  const [dirtyW, setDirtyW] = useState(false), [dirtyE, setDirtyE] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<string | null>(null);              // día abierto en la ventana
  const [draft, setDraft] = useState<Exception[]>([]);              // cambios de ese día, hasta que se guarden
  const [sheetErr, setSheetErr] = useState<string | null>(null);
  const [wk, setWk] = useState(0);                                   // semana elegida en «Más opciones»
  const dlg = useRef<HTMLDialogElement>(null);
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const dirty = dirtyW || dirtyE;

  const changeSlots = (next: Slot[]) => { setSlots(next); setDirtyW(true); setMsg(null); };
  const changeItems = (next: Exception[]) => { setItems(next); setDirtyE(true); setMsg(null); };

  // Aviso del navegador si se intenta salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ---------- Paso 1: semana habitual ----------
  const ofDay = (wd: number) => slots.map((s, i) => ({ s, i })).filter((x) => x.s.weekday === wd).sort((a, b) => a.s.startMin - b.s.startMin);
  function addRow(wd: number) {
    const last = ofDay(wd).at(-1)?.s;
    const startMin = last ? Math.min(last.endMin + 30, 1380) : 18 * 60;
    changeSlots([...slots, { weekday: wd, startMin, endMin: Math.min(startMin + 120, 1440), preferred: false }]);
  }
  function updateRow(i: number, patch: Partial<Slot>) {
    changeSlots(slots.map((s, k) => {
      if (k !== i) return s;
      const n = { ...s, ...patch };
      if (n.endMin <= n.startMin) n.endMin = Math.min(n.startMin + 60, 1440);
      return n;
    }));
  }

  // ---------- Paso 2: días en los que no puede ----------
  const weekStart = addDays(today, -(isoWeekday(today) - 1));
  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(weekStart, w * 7 + d))), [weekStart]);
  const stateOf = (d: string) => {
    const l = items.filter((e) => e.date === d);
    if (l.some((e) => e.status === "UNAVAILABLE" && whole(e))) return "blocked";
    if (l.some((e) => e.status === "UNAVAILABLE")) return "partial";
    if (l.some((e) => e.status === "AVAILABLE")) return "extra";
    return "";
  };
  const blockedCount = items.filter((e) => e.status === "UNAVAILABLE" && whole(e)).length;

  // ----- Ventana de un día: se edita un borrador y se guarda ese día aparte -----
  function openDay(d: string) { setDraft(items.filter((e) => e.date === d).map((e) => ({ ...e }))); setSheetErr(null); setSel(d); }
  useEffect(() => {
    const el = dlg.current;
    if (!el) return;
    if (sel && !el.open) el.showModal();
    else if (!sel && el.open) el.close();
  }, [sel]);
  const addDraft = (status: Exception["status"], startMin: number, endMin: number) => setDraft((d) => [...d, { date: sel!, startMin, endMin, status, preferred: false }]);
  const patchDraft = (i: number, p: Partial<Exception>) => setDraft((d) => d.map((e, k) => {
    if (k !== i) return e;
    const n = { ...e, ...p };
    if (n.endMin <= n.startMin) n.endMin = Math.min(n.startMin + 60, 1440);
    if (n.status === "UNAVAILABLE") n.preferred = false;
    return n;
  }));
  const hasWholeDay = draft.some((e) => e.status === "UNAVAILABLE" && whole(e));
  function saveDay() {
    if (!sel) return;
    const next = [...items.filter((e) => e.date !== sel), ...draft];
    const bad = validateExceptions(next, today);
    if (bad) { setSheetErr(bad); return; }
    setSheetErr(null);
    const label = longDate(sel);
    start(async () => {
      const r = await saveExceptionsAction(playerId, next);
      if (!r.ok) { setSheetErr(r.error ?? "No se ha podido guardar este día."); return; }
      setItems(r.items ?? normalizeExceptions(next)); setDirtyE(false); setSel(null);
      setMsg({ ok: true, text: `Guardado: ${label}.` });
    });
  }
  const clearWeek = (w: number) => changeItems(items.filter((e) => !weeks[w].includes(e.date)));
  const blockWeek = (w: number) => changeItems([...items.filter((e) => !weeks[w].includes(e.date) || e.status !== "UNAVAILABLE" || !whole(e)), ...weeks[w].filter((d) => d >= today).map((date): Exception => ({ date, startMin: 0, endMin: 1440, status: "UNAVAILABLE" }))]);
  function copyWeek(src: number, target: number) {
    if (src === target) return;
    if (!window.confirm(`Se copian los bloqueos de la semana del ${short(weeks[src][0])} a la del ${short(weeks[target][0])}, sustituyendo los que hubiera. ¿Continuar?`)) return;
    const copies = items.filter((e) => weeks[src].includes(e.date)).map((e) => ({ ...e, date: weeks[target][weeks[src].indexOf(e.date)] })).filter((e) => e.date >= today);
    changeItems([...items.filter((e) => !weeks[target].includes(e.date)), ...copies]);
  }
  function blockRange() {
    if (!from || !to || to < from) { setMsg({ ok: false, text: "Elige el primer y el último día del periodo (el último no puede ser anterior al primero)." }); return; }
    const days: string[] = [];
    for (let d = from < today ? today : from; d <= to && days.length <= 120; d = addDays(d, 1)) days.push(d);
    changeItems([...items.filter((e) => !(days.includes(e.date) && e.status === "UNAVAILABLE" && whole(e))), ...days.map((date): Exception => ({ date, startMin: 0, endMin: 1440, status: "UNAVAILABLE" }))]);
    setFrom(""); setTo("");
  }

  // ---------- Un solo guardado ----------
  function save() {
    const badW = dirtyW ? validateSlots(slots) : null, badE = dirtyE ? validateExceptions(items, today) : null;
    if (badW || badE) { setMsg({ ok: false, text: (badW ?? badE)! }); return; }
    start(async () => {
      let nSlots = slots.length, nBlocks = blockedCount;
      if (dirtyW) {
        const r = await saveAvailabilityAction(playerId, slots);
        if (!r.ok) { setMsg({ ok: false, text: r.error ?? "No se ha podido guardar tu semana habitual." }); return; }
        setSlots(r.slots ?? slots); nSlots = (r.slots ?? slots).length; setDirtyW(false);
      }
      if (dirtyE) {
        const r = await saveExceptionsAction(playerId, items);
        if (!r.ok) { setMsg({ ok: false, text: `Tu semana habitual se ha guardado, pero no los días bloqueados: ${r.error ?? "inténtalo de nuevo."}` }); return; }
        setItems(r.items ?? normalizeExceptions(items)); nBlocks = (r.items ?? items).filter((e) => e.status === "UNAVAILABLE" && whole(e)).length; setDirtyE(false);
      }
      setMsg({ ok: true, text: `Guardado. ${nSlots === 0 ? "Aún no has marcado ningún momento en tu semana habitual." : "Tu semana habitual está al día."}${nBlocks ? ` Tienes ${nBlocks} ${nBlocks === 1 ? "día bloqueado" : "días bloqueados"}.` : ""}` });
    });
  }
  const weeklyOf = (d: string) => summary(slots, isoWeekday(d)) || "sin franjas";

  return (
    <div>
      {/* ===== PASO 1 ===== */}
      <section className="avstep" aria-labelledby="paso1">
        <h2 id="paso1"><span className="avnum">1</span> Tu semana habitual</h2>
        <p className="subtle">Para cada día, añade las horas en las que sueles poder jugar. Si no puedes algún día, déjalo sin horas. Marca ★ <b>preferente</b> las que más te convienen: se recomiendan antes.</p>

        <div className="avdays">
          {WEEKDAYS.map((name, idx) => {
            const wd = idx + 1, day = ofDay(wd);
            return (
              <section key={wd} className="avday" aria-label={name}>
                <div className="avhead"><h3>{name}</h3><button type="button" className="btn btn-outline btn-sm" onClick={() => addRow(wd)} disabled={day.length >= 8}>+ Añadir horas</button></div>
                <div className="avbar" aria-hidden>{day.map(({ s, i }) => <i key={i} className={s.preferred ? "pref" : ""} style={{ left: `${(s.startMin / 1440) * 100}%`, width: `${((s.endMin - s.startMin) / 1440) * 100}%` }} />)}</div>
                <div className="avticks" aria-hidden><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
                {day.length === 0 ? <p className="subtle" style={{ margin: ".4rem 0 0" }}>Sin horas (no se considera libre).</p> : day.map(({ s, i }) => (
                  <div key={i}>
                    <div className="avrow">
                      <label className="sr-only" htmlFor={`f${i}`}>Desde</label>
                      <select id={`f${i}`} value={s.startMin} onChange={(e) => updateRow(i, { startMin: Number(e.target.value) })}>{START_OPTIONS.map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}</select>
                      <span>a</span>
                      <label className="sr-only" htmlFor={`t${i}`}>Hasta</label>
                      <select id={`t${i}`} value={s.endMin} onChange={(e) => updateRow(i, { endMin: Number(e.target.value) })}>{END_OPTIONS.filter((m) => m > s.startMin).map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}</select>
                    </div>
                    <div className="avrow2">
                      <label className="check"><input type="checkbox" checked={Boolean(s.preferred)} onChange={(e) => updateRow(i, { preferred: e.target.checked })} /> ★ Preferente</label>
                      <button type="button" className="btn btn-outline btn-sm" aria-label={`Quitar estas horas de ${name}`} onClick={() => changeSlots(slots.filter((_, k) => k !== i))}>Quitar</button>
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </section>

      {/* ===== PASO 2 ===== */}
      <section className="avstep" aria-labelledby="paso2">
        <h2 id="paso2"><span className="avnum">2</span> Días concretos <span className="subtle" style={{ fontWeight: 700 }}>(opcional)</span></h2>
        <p className="subtle">Marca los días en los que NO puedes jugar (viaje, trabajo, lesión…) o en los que puedes unas horas extra. <b>Toca un día</b> para ver y cambiar el suyo.</p>
        <p className="avlegend" aria-hidden><i className="lg blocked" /> Día bloqueado <i className="lg partial" /> Bloqueo de unas horas <i className="lg extra" /> Horas extra</p>

        <div className="daycal" role="group" aria-label="Calendario de los próximos días">
          <div className="weekrow" aria-hidden>{WEEKDAYS.map((d) => <small key={d} className="subtle" style={{ textAlign: "center", fontWeight: 800 }}>{d.slice(0, 3)}</small>)}</div>
          {weeks.map((w, wi) => (
            <div className="weekrow" key={wi}>
              {w.map((d) => (
                <button key={d} type="button" className={`daycell ${stateOf(d)}${d < today ? " past" : ""}`} disabled={d < today} onClick={() => openDay(d)} aria-haspopup="dialog"
                  aria-label={`${longDate(d)}${stateOf(d) === "blocked" ? ", bloqueado" : stateOf(d) === "partial" ? ", bloqueo de unas horas" : stateOf(d) === "extra" ? ", con horas extra" : ""}`}>
                  <span>{Number(d.slice(8))}</span><small>{d.endsWith("-01") || d === w[0] ? MONTHS[Number(d.slice(5, 7)) - 1] : stateOf(d) === "blocked" ? "✕" : stateOf(d) === "partial" ? "◐" : stateOf(d) === "extra" ? "+" : "\u00a0"}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
        <p className="subtle" style={{ margin: ".4rem 0 0" }}>{blockedCount === 0 ? "No tienes ningún día bloqueado entero." : `${blockedCount} ${blockedCount === 1 ? "día bloqueado entero" : "días bloqueados enteros"}.`}</p>

        <div className="avrange">
          <b>¿Vacaciones o un viaje largo?</b>
          <div className="exline" style={{ marginTop: ".4rem" }}>
            <label htmlFor="r-from">Del</label><input id="r-from" type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} />
            <label htmlFor="r-to">al</label><input id="r-to" type="date" value={to} min={from || today} onChange={(e) => setTo(e.target.value)} />
            <button type="button" className="btn btn-outline btn-sm" onClick={blockRange}>Bloquear esos días</button>
          </div>
        </div>

        <details className="avadv">
          <summary>Más opciones: bloquear una semana entera, vaciarla o copiarla a otra</summary>
          <p className="subtle" style={{ margin: ".5rem 0" }}>Elige una semana. Estos cambios se guardan con el botón «Guardar» de abajo.</p>
          <label htmlFor="wk">Semana</label>
          <select id="wk" value={wk} onChange={(e) => setWk(Number(e.target.value))}>{weeks.map((w, i) => <option key={i} value={i}>Semana del {short(w[0])}</option>)}</select>
          <div className="actions" style={{ margin: ".6rem 0" }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => blockWeek(wk)}>Bloquear esa semana</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => clearWeek(wk)}>Vaciar esa semana</button>
          </div>
          <label htmlFor="cpto">Copiar los bloqueos de esa semana a</label>
          <select id="cpto" value="" onChange={(e) => { if (e.target.value !== "") copyWeek(wk, Number(e.target.value)); }}>
            <option value="">Elige la semana de destino…</option>
            {weeks.map((w, i) => i !== wk && <option key={i} value={i}>Semana del {short(w[0])}</option>)}
          </select>
        </details>
      </section>

      {/* ===== GUARDAR ===== */}
      <div className="avsave">
        <button type="button" className="btn btn-navy" onClick={save} disabled={pending || !dirty}>{pending ? "Guardando…" : `Guardar la disponibilidad de ${playerName.split(" ")[0]}`}</button>
        {dirty && !pending && <span className="subtle">Tienes cambios sin guardar.</span>}
        {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "okmsg" : "error"} style={{ margin: 0 }}>{msg.text}</span>}
      </div>

      {/* ===== VENTANA DE UN DÍA ===== */}
      <dialog ref={dlg} className="daysheet" aria-labelledby="daysheet-title" onClose={() => setSel(null)} onClick={(e) => { if (e.target === dlg.current) setSel(null); }}>
        {sel && (
          <div className="daysheet-body">
            <div className="daysheet-head">
              <h3 id="daysheet-title">{longDate(sel)}</h3>
              <button type="button" className="toast-x" aria-label="Cerrar sin guardar" onClick={() => setSel(null)}>×</button>
            </div>
            <p className="subtle" style={{ margin: ".2rem 0 .75rem" }}>Tu semana habitual ese día: {weeklyOf(sel)}.</p>

            {draft.length === 0
              ? <p className="subtle">Este día no tiene cambios: vale tu semana habitual. Añade abajo un bloqueo o unas horas extra.</p>
              : draft.map((e, i) => (
                <div className="exrow" key={i}>
                  <div className="exline">
                    <label className="sr-only" htmlFor={`st${i}`}>Tipo</label>
                    <select id={`st${i}`} value={e.status} onChange={(ev) => patchDraft(i, { status: ev.target.value as Exception["status"] })}>
                      <option value="UNAVAILABLE">No puedo</option><option value="AVAILABLE">Sí puedo (extra)</option>
                    </select>
                    <label className="sr-only" htmlFor={`a${i}`}>Desde</label>
                    <select id={`a${i}`} value={e.startMin} onChange={(ev) => patchDraft(i, { startMin: Number(ev.target.value) })}>{START_OPTIONS.map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}</select>
                    <span>a</span>
                    <label className="sr-only" htmlFor={`b${i}`}>Hasta</label>
                    <select id={`b${i}`} value={e.endMin} onChange={(ev) => patchDraft(i, { endMin: Number(ev.target.value) })}>{END_OPTIONS.filter((m) => m > e.startMin).map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}</select>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft((d) => d.filter((_, k) => k !== i))} aria-label="Quitar">Quitar</button>
                  </div>
                  <div className="exline">
                    {e.status === "AVAILABLE"
                      ? <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={Boolean(e.preferred)} onChange={(ev) => patchDraft(i, { preferred: ev.target.checked })} /> ★ Preferente</label>
                      : <><label className="sr-only" htmlFor={`n${i}`}>Nota privada</label><input id={`n${i}`} type="text" maxLength={80} placeholder="Nota privada (opcional; no la ve nadie del otro lado)" value={e.note ?? ""} onChange={(ev) => patchDraft(i, { note: ev.target.value })} /></>}
                  </div>
                </div>
              ))}

            <div className="daysheet-add">
              <button type="button" className="btn btn-outline btn-sm" disabled={hasWholeDay} onClick={() => addDraft("UNAVAILABLE", 0, 1440)}>No puedo en todo el día</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => addDraft("UNAVAILABLE", 18 * 60, 22 * 60)}>No puedo en unas horas</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => addDraft("AVAILABLE", 18 * 60, 22 * 60)}>Sí puedo en unas horas (extra)</button>
            </div>
            {sheetErr && <p role="alert" className="error" style={{ margin: ".75rem 0 0" }}>{sheetErr}</p>}

            <div className="daysheet-foot">
              <button type="button" className="btn btn-outline" onClick={() => setSel(null)}>Cancelar</button>
              <button type="button" className="btn btn-navy" onClick={saveDay} disabled={pending}>{pending ? "Guardando…" : "Guardar este día"}</button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

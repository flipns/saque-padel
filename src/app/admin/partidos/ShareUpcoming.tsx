"use client";
import { useEffect, useMemo, useState } from "react";
import { buildShareText, filterUpcoming, whatsappUrl, type ShareMatch } from "@/lib/share";

const RANGES = [["7", "Próximos 7 días"], ["14", "Próximos 14 días"], ["all", "Todos los programados"]] as const;
type Range = (typeof RANGES)[number][0];

/** Genera el texto de los próximos partidos para pegarlo en el grupo de WhatsApp de la liga. */
export function ShareUpcoming({ matches, nowIso, scope }: { matches: ShareMatch[]; nowIso: string; scope: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [range, setRange] = useState<Range>("7");
  const list = useMemo(() => filterUpcoming(matches, now, range === "all" ? null : Number(range)), [matches, now, range]);
  const generated = useMemo(
    () => buildShareText(list, { emptyText: range === "all" ? "Por ahora no hay partidos programados." : `En ${range === "7" ? "los próximos 7 días" : "los próximos 14 días"} no hay partidos programados.` }),
    [list, range]
  );
  const [text, setText] = useState(generated);
  const [status, setStatus] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setText(generated); setStatus(""); }, [generated]);
  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);

  async function share() {
    try { await navigator.share({ text }); setStatus("Compartido."); }
    catch (e: any) { if (e?.name !== "AbortError") setStatus("No se ha podido abrir el menú de compartir: usa «Copiar texto»."); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setStatus("Texto copiado. Ya puedes pegarlo en WhatsApp."); }
    catch {
      const ta = document.getElementById("share-text") as HTMLTextAreaElement | null;
      if (ta) { ta.select(); setStatus(document.execCommand("copy") ? "Texto copiado. Ya puedes pegarlo en WhatsApp." : "Selecciona el texto y cópialo a mano."); }
    }
  }
  const waUrl = whatsappUrl(text);
  const waOk = waUrl.length < 6000;

  return (
    <details className="card share">
      <summary><span className="btn btn-navy" style={{ pointerEvents: "none" }}>Compartir los próximos partidos</span></summary>
      <p className="subtle" style={{ margin: ".75rem 0" }}>Genera un mensaje con día, hora, pista, categoría y las parejas de cada partido, para el grupo de WhatsApp de la liga. Incluye: {scope}.</p>
      <div className="fields" style={{ maxWidth: 360 }}>
        <div>
          <label htmlFor="share-range">Qué partidos incluir</label>
          <select id="share-range" value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <label htmlFor="share-text" style={{ marginTop: ".85rem" }}>Mensaje <span className="subtle" style={{ fontWeight: 600 }}>({list.length} {list.length === 1 ? "partido" : "partidos"} · puedes editarlo antes de compartir)</span></label>
      <textarea id="share-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="actions" style={{ marginTop: ".75rem" }}>
        {canShare && <button type="button" className="btn btn-navy" onClick={share}>Compartir…</button>}
        <button type="button" className={canShare ? "btn btn-outline" : "btn btn-navy"} onClick={copy}>Copiar texto</button>
        {waOk
          ? <a className="btn btn-outline" href={waUrl} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>
          : <span className="subtle">El mensaje es muy largo para abrir WhatsApp directamente: usa «Compartir» o «Copiar texto».</span>}
      </div>
      <p role="status" aria-live="polite" className="okmsg" style={{ margin: ".6rem 0 0", minHeight: "1.2em" }}>{status}</p>
    </details>
  );
}

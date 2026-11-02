"use client";
import { useState, useTransition } from "react";
import Papa from "papaparse";
import { parseFormRows, type ImportedRow } from "@/lib/engine/importForm";
import { commitImport, type ImportResult } from "./actions";

const LEVEL: Record<string, string> = { PREMIER: "Premier", ORO: "Oro", PLATA: "Plata", BRONCE: "Bronce", ROOKIE: "Rookie" };

export function Importer() {
  const [rows, setRows] = useState<ImportedRow[] | null>(null);
  const [headerIssues, setHeaderIssues] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  function onFile(file: File) {
    setResult(null);
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const parsed = parseFormRows(res.data);
        setRows(parsed.rows);
        setHeaderIssues(parsed.headerIssues);
        // Por defecto se excluyen las filas sustituidas por otra más reciente.
        setExcluded(new Set(parsed.rows.filter((r) => r.duplicateOf).map((r) => r.rowNumber)));
      },
    });
  }

  const toImport = (rows ?? []).filter((r) => !excluded.has(r.rowNumber));

  return (
    <>
      <div style={{ maxWidth: 520 }}>
        <label htmlFor="csv">CSV de respuestas del Form</label>
        <input id="csv" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <p className="muted" style={{ fontSize: ".9rem" }}>
          En la hoja de respuestas: Archivo, Descargar, Valores separados por comas (.csv).
        </p>
      </div>

      {headerIssues.length > 0 && (
        <div role="alert" className="tag-bad" style={{ padding: "1rem", borderRadius: 10, marginTop: "1rem" }}>
          {headerIssues.map((h) => <p key={h} style={{ margin: 0 }}>{h}</p>)}
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <p style={{ marginTop: "1.5rem" }}>
            <b>{rows.length}</b> filas leídas, <b>{toImport.length}</b> marcadas para importar. Desmarca las que no quieras crear.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Importar</th><th>Fila</th><th>Categoría</th><th>Jugador 1</th><th>Jugador 2</th><th>Email</th><th>Revisar</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNumber} style={excluded.has(r.rowNumber) ? { opacity: 0.5 } : undefined}>
                    <td>
                      <input type="checkbox" aria-label={`Importar fila ${r.rowNumber}`} checked={!excluded.has(r.rowNumber)}
                        onChange={(e) => {
                          const n = new Set(excluded);
                          e.target.checked ? n.delete(r.rowNumber) : n.add(r.rowNumber);
                          setExcluded(n);
                        }} />
                    </td>
                    <td>{r.rowNumber}</td>
                    <td>{r.level ? `${LEVEL[r.level]} ${r.division === "FEMENINA" ? "fem." : "masc."}` : <span className="tag tag-bad">{r.categoryRaw || "vacía"}</span>}</td>
                    <td>{r.player1.name}<br /><small className="muted">{r.player1.phone}</small></td>
                    <td>{r.player2.name}<br /><small className="muted">{r.player2.phone}</small></td>
                    <td>{r.email}</td>
                    <td>
                      {r.duplicateOf && <span className="tag tag-warn">Repetida, vale la fila {r.duplicateOf}</span>}
                      {r.issues.map((i) => <div key={i}><span className="tag tag-warn">{i}</span></div>)}
                      {!r.duplicateOf && r.issues.length === 0 && <span className="tag tag-ok">Correcta</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-navy" style={{ marginTop: "1.25rem" }} disabled={pending || toImport.length === 0}
            onClick={() => start(async () => setResult(await commitImport(toImport)))}>
            {pending ? "Importando…" : `Importar ${toImport.length} parejas`}
          </button>
        </>
      )}

      {result && (
        <div role="status" style={{ marginTop: "1.5rem" }}>
          <p><b>{result.created}</b> parejas creadas. {result.skipped.length} omitidas, {result.errors.length} con error.</p>
          {[...result.skipped.map((x) => `Fila ${x.row}: ${x.reason}`), ...result.errors.map((x) => `Fila ${x.row}: ${x.message}`)].map((t) => (
            <p key={t} className="muted" style={{ margin: ".2rem 0" }}>{t}</p>
          ))}
        </div>
      )}
    </>
  );
}

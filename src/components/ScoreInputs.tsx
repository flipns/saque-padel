import type { SetScore } from "@/lib/engine";

/** Marcador set a set. `left`/`right` son las etiquetas de cada columna (p. ej. «Nosotros» / «Ellos»). */
export function ScoreInputs({ left, right, initial = [] }: { left: string; right: string; initial?: SetScore[] }) {
  return (
    <div className="setrows" role="group" aria-label="Marcador">
      <div className="setrow head"><span /><span>{left}</span><span>{right}</span></div>
      {[1, 2, 3].map((n) => {
        const s = initial[n - 1];
        return (
          <div className="setrow" key={n}>
            <span>Set {n}{n === 3 ? " (si hubo)" : ""}</span>
            <input name={`s${n}a`} type="number" inputMode="numeric" min={0} max={7} defaultValue={s?.a ?? ""} aria-label={`Set ${n}, ${left}`} />
            <input name={`s${n}b`} type="number" inputMode="numeric" min={0} max={7} defaultValue={s?.b ?? ""} aria-label={`Set ${n}, ${right}`} />
          </div>
        );
      })}
    </div>
  );
}

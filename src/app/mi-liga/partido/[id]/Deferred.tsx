import { Suspense } from "react";
import { Suggestions } from "./Suggestions";
import type { Suggestions as SuggestionsData } from "@/lib/matching";

/**
 * «Mejores horarios» se calcula con los calendarios de los cuatro jugadores y es lo más pesado de la pantalla.
 * Se envía en diferido (streaming): la ficha del partido aparece enseguida y este bloque se rellena cuando llega.
 */
export type SuggestionsPromise = Promise<SuggestionsData | null>;

async function SuggestionsSlot({ promise, ...props }: { promise: SuggestionsPromise } & Omit<React.ComponentProps<typeof Suggestions>, "data" | "meMissing"> & { meId?: string }) {
  const data = await promise;
  if (!data) return null;
  const { meId, ...rest } = props;
  return <Suggestions {...rest} data={data} meMissing={Boolean(meId && data.missing.some((x) => x.id === meId))} />;
}

export function SuggestionsDeferred(props: { promise: SuggestionsPromise } & Omit<React.ComponentProps<typeof Suggestions>, "data" | "meMissing"> & { meId?: string }) {
  return (
    <Suspense fallback={
      <div className="card" id="horarios" style={{ marginTop: "1rem" }} aria-busy="true">
        <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>Mejores horarios para los cuatro</h2>
        <p className="subtle" style={{ margin: 0 }}>Calculando los horarios en los que coincidís los cuatro…</p>
      </div>
    }>
      <SuggestionsSlot {...props} />
    </Suspense>
  );
}

async function HintPill({ promise, id }: { promise: SuggestionsPromise; id: string }) {
  const data = await promise;
  const h = data?.hints[id];
  return h ? <span className={`pill${h.tone === "muted" ? "" : ` pill-${h.tone}`}`}>{h.text}</span> : null;
}

/** Indicación de cómo encaja un horario propuesto con los calendarios; aparece cuando está calculada. */
export function HintTag({ promise, id }: { promise?: SuggestionsPromise | null; id: string }) {
  if (!promise) return null;
  return <Suspense fallback={null}><HintPill promise={promise} id={id} /></Suspense>;
}

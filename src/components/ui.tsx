import Link from "next/link";
import type { Cat } from "@/lib/data";

export const CAT_COLOR: Record<string, string> = {
  PREMIER: "var(--navy)", ORO: "var(--gold)", PLATA: "var(--silver)", BRONCE: "var(--bronze)", ROOKIE: "var(--rookie)",
};

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (err) return <p role="alert" className="flash flash-err">{err}</p>;
  if (ok) return <p role="status" className="flash flash-ok">{ok}</p>;
  return null;
}

type Tone = "ok" | "warn" | "bad" | "info" | "navy" | "muted";
export function Pill({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`pill${tone === "muted" ? "" : ` pill-${tone}`}`}>{children}</span>;
}

export const MATCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_SCHEDULE: { label: "Sin fecha", tone: "warn" },
  SCHEDULE_PROPOSED: { label: "Fecha propuesta", tone: "warn" },
  DATE_AGREED: { label: "Falta pista", tone: "info" },
  SCHEDULED: { label: "Programado", tone: "ok" },
  RESCHEDULE_REQUESTED: { label: "Cambio de fecha", tone: "warn" },
  PLAYED_PENDING_RESULT: { label: "Falta resultado", tone: "warn" },
  RESULT_PENDING_CONFIRMATION: { label: "Por confirmar", tone: "warn" },
  DISPUTED: { label: "Impugnado", tone: "bad" },
  COMPLETED: { label: "Jugado", tone: "ok" },
  WO: { label: "WO", tone: "muted" },
  NOT_PLAYED: { label: "No disputado", tone: "muted" },
  CANCELLED: { label: "Cancelado", tone: "muted" },
};
export const MatchPill = ({ status }: { status: string }) => {
  const s = MATCH_STATUS[status] ?? { label: status, tone: "muted" as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
};

export const PHASE_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Sin generar", tone: "muted" },
  GENERATED: { label: "Por revisar", tone: "warn" },
  REVIEWED: { label: "Revisada", tone: "warn" },
  PUBLISHED: { label: "Publicada", tone: "ok" },
  ACTIVE: { label: "En juego", tone: "ok" },
  CLOSED: { label: "Cerrada", tone: "info" },
  LOCKED: { label: "Bloqueada", tone: "navy" },
};
export const PhasePill = ({ status }: { status: string }) => {
  const s = PHASE_STATUS[status] ?? { label: status, tone: "muted" as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
};

export function CatDot({ code }: { code: string }) {
  return <i className="dot" style={{ background: CAT_COLOR[code] ?? "var(--blue)" }} aria-hidden />;
}

/** Selector de categorías en forma de «chips». Cada chip es un enlace. */
export function CategoryChips({ cats, current, href, all }: { cats: Cat[]; current?: string | null; href: (id: string | null) => string; all?: string }) {
  return (
    <nav className="chips" aria-label="Categorías">
      {all && <Link className="chip" href={href(null)} aria-current={!current}>{all}</Link>}
      {cats.map((c) => (
        <Link key={c.id} className="chip" href={href(c.id)} aria-current={current === c.id}>
          <CatDot code={c.code} />{c.label}
        </Link>
      ))}
    </nav>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="pagehead">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export const Progress = ({ value, max }: { value: number; max: number }) => (
  <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}><i style={{ width: `${max ? Math.round((value / max) * 100) : 0}%` }} /></div>
);

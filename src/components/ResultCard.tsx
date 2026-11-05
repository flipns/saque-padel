import type { Cat, MatchView, PairView } from "@/lib/data";
import { pairName } from "@/lib/data";
import { fmtDate } from "@/lib/dates";
import { matchWhen } from "@/lib/data";
import { MatchPill } from "@/components/ui";

/** Partido en modo lectura (el de cualquier pareja de la liga). */
export function ResultCard({ m, pairs, cat, mine, showCat = true }: { m: MatchView; pairs: Map<string, PairView>; cat?: Cat; mine?: Set<string>; showCat?: boolean }) {
  const a = pairs.get(m.pairA), b = pairs.get(m.pairB);
  const done = m.status === "COMPLETED" || m.status === "RESULT_PENDING_CONFIRMATION";
  const mark = (id: string) => (mine?.has(id) ? " ★" : "");
  return (
    <div className="match" style={mine && (mine.has(m.pairA) || mine.has(m.pairB)) ? { borderColor: "var(--ok)" } : undefined}>
      <div className="meta"><span>{showCat && cat ? `${cat.label} · ` : ""}Grupo {m.groupLetter}</span><MatchPill status={m.status} /></div>
      <div className="teams">
        <span className={`team${m.winner === "A" ? " win" : ""}`}>{pairName(a)}{mark(m.pairA)}</span><span className="sets">{done ? m.sets.map((s) => s.a).join(" ") : ""}</span>
        <span className={`team${m.winner === "B" ? " win" : ""}`}>{pairName(b)}{mark(m.pairB)}</span><span className="sets">{done ? m.sets.map((s) => s.b).join(" ") : ""}</span>
      </div>
      <div className="when">
        {m.status === "WO" ? "WO" : m.status === "NOT_PLAYED" ? "No disputado" : done
          ? `${m.status === "COMPLETED" ? "Confirmado" : "Pendiente de confirmar"}${m.confirmedAt ? ` · ${fmtDate(m.confirmedAt)}` : ""}${m.endedByTime ? " · por tiempo" : ""}`
          : m.status === "SCHEDULED" || m.status === "DATE_AGREED" ? matchWhen(m) : "Sin jugar"}
      </div>
    </div>
  );
}

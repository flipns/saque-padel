import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import type { Exception, Slot } from "@/lib/availability";
import { isoToMadridParts } from "@/lib/dates";
import { AvailabilityEditor } from "./AvailabilityEditor";

export const metadata = { title: "Disponibilidad · SAQUE LEAGUE" };

type Row = { player_id: string; full_name: string; is_me: boolean; has_access: boolean };

export default async function Disponibilidad({ searchParams }: { searchParams: Promise<{ j?: string }> }) {
  const sp = await searchParams;
  const { sb, pairIds } = await requirePlayer("/mi-liga/disponibilidad");
  if (pairIds.length === 0) return <p className="card empty">Tu email no tiene pareja inscrita.</p>;
  const identities = (await Promise.all(pairIds.map((id) => sb.rpc("pair_identity", { p_pair: id })))).flatMap((r) => (r.data ?? []) as Row[]);
  const people = [...new Map(identities.map((r) => [r.player_id, r])).values()];
  const me = people.find((p) => p.is_me);
  if (!me) {
    return (
      <div className="card empty">
        <h1 style={{ fontSize: "1.3rem", marginBottom: ".5rem" }}>Primero indica quién eres</h1>
        <p>Para rellenar tu disponibilidad, elige tu nombre en el inicio.</p>
        <p><Link className="btn btn-navy" href="/mi-liga">Ir al inicio</Link></p>
      </div>
    );
  }
  const selected = people.find((p) => p.player_id === sp.j) ?? me;
  const today = isoToMadridParts(new Date().toISOString()).date;
  const [rulesRes, excRes] = await Promise.all([
    sb.from("availability_rules").select("weekday, start_min, end_min, preferred").eq("player_id", selected.player_id),
    sb.from("availability_exceptions").select("on_date, start_min, end_min, status, preferred, note").eq("player_id", selected.player_id).gte("on_date", today),
  ]);
  const slots: Slot[] = ((rulesRes.data ?? []) as any[]).map((r) => ({ weekday: r.weekday, startMin: r.start_min, endMin: r.end_min, preferred: r.preferred }));
  const exceptions: Exception[] = ((excRes.data ?? []) as any[]).map((r) => ({ date: r.on_date, startMin: r.start_min, endMin: r.end_min, status: r.status, preferred: r.preferred, note: r.note ?? undefined }));

  return (
    <>
      <h1 style={{ fontSize: "var(--step-2)", fontWeight: 900, textTransform: "uppercase" }}>Disponibilidad</h1>
      <p className="muted" style={{ margin: ".3rem 0 .75rem", maxWidth: "62ch" }}>
        Cuéntanos cuándo puedes jugar y te sugeriremos horarios de 90 minutos en los que coincidís los cuatro de cada partido. Son solo dos pasos.
      </p>
      <p className="hint" style={{ marginBottom: "1.25rem" }}>Lo que no marques lo tomamos como «sin información», no como libre. Tus rivales no ven tu calendario: solo ven los horarios en los que coincidís los cuatro. Tu compañero/a sí puede verlo y editarlo.</p>
      {people.length > 1 && (
        <nav className="chips" aria-label="De quién es la disponibilidad">
          {people.map((p) => <Link key={p.player_id} className="chip" href={`/mi-liga/disponibilidad?j=${p.player_id}`} aria-current={p.player_id === selected.player_id}>{p.is_me ? `Yo (${p.full_name})` : `${p.full_name} (compañero/a)`}</Link>)}
        </nav>
      )}
      {!selected.is_me && <p className="callout warn">Estás editando la disponibilidad de {selected.full_name}. Avísale de lo que pongas.</p>}
      <AvailabilityEditor key={selected.player_id} playerId={selected.player_id} playerName={selected.full_name} initialSlots={slots} initialExceptions={exceptions} today={today} />
    </>
  );
}

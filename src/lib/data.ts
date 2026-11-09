import { memoFor } from "./memo";
import { cache } from "react";
import { fmtDateTime } from "@/lib/dates";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  levelingStandings, mergeRules, replayRanking, pairKey, groupSizes,
  type MatchRecord, type RankingEvent, type SetScore, type Side, type StandingRow,
} from "@/lib/engine";

type SB = SupabaseClient;
export type Division = "MASCULINA" | "FEMENINA";

const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

// ---------- Temporada y categorías ----------

export interface SeasonRow {
  id: string; code: string; name: string; rules: any; prize: any;
  registration_deadline_at: string; season_starts_at: string; share_rival_contact: boolean;
  entry_fee_per_player: number; registration_form_url: string | null;
}

export const getSeasonRow = (sb: SB): Promise<SeasonRow | null> => memoFor(sb, "season", async () => {
  const { data } = await sb.from("seasons").select("*").eq("is_current", true).maybeSingle();
  return (data as SeasonRow) ?? null;
});

export interface Cat {
  id: string; code: string; name: string; level: number;
  division: Division; divisionId: string;
  label: string; // «Oro femenina»
}

export const divLabel = (d: Division) => (d === "FEMENINA" ? "femenina" : "masculina");

export const loadCats = (sb: SB, seasonId: string): Promise<Cat[]> => memoFor(sb, `cats:${seasonId}`, async () => {
  const { data } = await sb
    .from("categories")
    .select("id, code, name, level_order, active, divisions!inner(id, code, season_id)")
    .eq("divisions.season_id", seasonId)
    .eq("active", true);
  return ((data ?? []) as any[])
    .map((c) => {
      const d = one<any>(c.divisions);
      return {
        id: c.id, code: c.code, name: c.name, level: c.level_order,
        division: d.code as Division, divisionId: d.id as string,
        label: `${c.name} ${divLabel(d.code)}`,
      };
    })
    .sort((a, b) => (a.division === b.division ? a.level - b.level : a.division === "MASCULINA" ? -1 : 1));
});

export const loadPhases = (sb: SB, seasonId: string) => memoFor(sb, `phases:${seasonId}`, async () => {
  const { data } = await sb.from("phases").select("*").eq("season_id", seasonId).order("number");
  return (data ?? []) as {
    id: string; number: number; kind: "LEVELING" | "RACE"; name: string; starts_on: string; ends_on: string;
    results_deadline: string; status: string; generator_seed: number | null; published_at: string | null;
  }[];
});

/** Temporada, categorías y fases: lo que casi toda pantalla necesita. */
// Identificador de la temporada activa, recordado un minuto en esta instancia del servidor (no es un dato sensible).
// Permite pedir a la vez la temporada, las categorías y las fases, en lugar de una detrás de otra.
let activeSeason: { id: string; at: number } | null = null;

export const loadBase = (sb: SB) => memoFor(sb, "base", async () => {
  const hint = activeSeason && Date.now() - activeSeason.at < 60_000 ? activeSeason.id : null;
  const seasonP = getSeasonRow(sb);
  if (hint) {
    const [season, cats, phases] = await Promise.all([seasonP, loadCats(sb, hint), loadPhases(sb, hint)]);
    if (!season) return null;
    if (season.id === hint) return { season, cats, phases };
    // La temporada activa ha cambiado desde la última vez: se piden de nuevo con la correcta.
  }
  const season = await seasonP;
  if (!season) return null;
  activeSeason = { id: season.id, at: Date.now() };
  const [cats, phases] = await Promise.all([loadCats(sb, season.id), loadPhases(sb, season.id)]);
  return { season, cats, phases };
});


// ---------- Parejas ----------

export interface PlayerView { id: string; name: string; isMinor: boolean; phone: string | null }
export interface PairView { id: string; categoryId: string; status: string; players: PlayerView[]; emails: string[] }

export const pairName = (p?: PairView | null) => (p ? p.players.map((x) => x.name).join(" / ") : "—");

type PairOpts = { contacts?: boolean; emails?: boolean; categoryId?: string; ids?: string[] };
export const loadPairs = (sb: SB, seasonId: string, opts: PairOpts = {}) => loadPairsC(sb, seasonId, JSON.stringify(opts));

const loadPairsC = cache(async (sb: SB, seasonId: string, key: string): Promise<PairView[]> => {
  const opts: PairOpts = JSON.parse(key);
  const sel =
    `id, category_id, status, pair_members(slot, players(id, full_name, is_minor${opts.contacts ? ", player_contacts(phone)" : ""}))` +
    (opts.emails ? ", pair_access(email)" : "");
  let q = sb.from("pairs").select(sel).eq("season_id", seasonId);
  if (opts.categoryId) q = q.eq("category_id", opts.categoryId);
  if (opts.ids) q = q.in("id", opts.ids);
  const { data, error } = await q.limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((p) => ({
    id: p.id,
    categoryId: p.category_id,
    status: p.status,
    players: [...(p.pair_members ?? [])]
      .sort((a: any, b: any) => a.slot - b.slot)
      .map((m: any) => {
        const pl = one<any>(m.players);
        const contact = one<any>(pl?.player_contacts);
        return { id: pl.id, name: pl.full_name, isMinor: pl.is_minor, phone: contact?.phone ?? null };
      }),
    emails: (p.pair_access ?? []).map((a: any) => a.email),
  }));
});

export const pairMap = (pairs: PairView[]) => new Map(pairs.map((p) => [p.id, p]));

// ---------- Partidos ----------

export interface MatchView {
  id: string; phaseId: string; phaseNumber: number; groupId: string; groupLetter: string; categoryId: string;
  pairA: string; pairB: string; status: string; scheduledAt: string | null; court: string | null;
  sets: SetScore[]; endedByTime: boolean; winner: Side | null; pointsOverride: { a: number; b: number } | null;
  confirmedAt: string | null; updatedAt: string; agreedStartAt: string | null;
}

export interface MatchFilter { phaseId?: string; categoryId?: string; pairIds?: string[]; statuses?: string[]; id?: string; maxPhaseNumber?: number }

export const loadMatches = (sb: SB, seasonId: string, f: MatchFilter = {}) => loadMatchesC(sb, seasonId, JSON.stringify(f));

const loadMatchesC = cache(async (sb: SB, seasonId: string, key: string): Promise<MatchView[]> => {
  const f: MatchFilter = JSON.parse(key);
  let q = sb
    .from("matches")
    .select("id, phase_id, group_id, pair_a_id, pair_b_id, status, scheduled_at, court, sets, ended_by_time, winner_side, points_override, confirmed_at, updated_at, agreed_start_at, groups!inner(letter, category_id), phases!inner(number, season_id)")
    .eq("phases.season_id", seasonId);
  if (f.id) q = q.eq("id", f.id);
  if (f.phaseId) q = q.eq("phase_id", f.phaseId);
  if (f.categoryId) q = q.eq("groups.category_id", f.categoryId);
  if (f.statuses?.length) q = q.in("status", f.statuses);
  if (f.maxPhaseNumber) q = q.lte("phases.number", f.maxPhaseNumber);
  if (f.pairIds?.length) {
    const list = f.pairIds.join(",");
    q = q.or(`pair_a_id.in.(${list}),pair_b_id.in.(${list})`);
  }
  const { data, error } = await q.limit(2000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[])
    .map((m) => {
      const g = one<any>(m.groups), ph = one<any>(m.phases);
      return {
        id: m.id, phaseId: m.phase_id, phaseNumber: ph.number, groupId: m.group_id, groupLetter: g.letter, categoryId: g.category_id,
        pairA: m.pair_a_id, pairB: m.pair_b_id, status: m.status, scheduledAt: m.scheduled_at, court: m.court,
        sets: (m.sets ?? []) as SetScore[], endedByTime: m.ended_by_time, winner: m.winner_side as Side | null,
        pointsOverride: m.points_override, confirmedAt: m.confirmed_at, updatedAt: m.updated_at, agreedStartAt: m.agreed_start_at ?? null,
      } as MatchView;
    })
    .sort((a, b) => a.phaseNumber - b.phaseNumber || a.groupLetter.localeCompare(b.groupLetter) || a.id.localeCompare(b.id));
});

export const toRecord = (m: MatchView): MatchRecord => ({
  id: m.id, pairA: m.pairA, pairB: m.pairB, status: m.status as MatchRecord["status"],
  sets: m.sets, winner: m.winner, pointsOverride: m.pointsOverride,
});

/** Texto corto sobre la fecha de un partido, según en qué punto de la coordinación esté. */
export function matchWhen(m: MatchView): string {
  switch (m.status) {
    case "SCHEDULED": return `Programado: ${fmtDateTime(m.scheduledAt)}${m.court ? ` · ${m.court}` : ""}`;
    case "DATE_AGREED": return `Fecha acordada: ${fmtDateTime(m.agreedStartAt)} · falta reservar la pista`;
    case "RESCHEDULE_REQUESTED": return `Cambio de fecha en curso${m.scheduledAt ? ` · sigue vigente ${fmtDateTime(m.scheduledAt)}` : ""}`;
    case "SCHEDULE_PROPOSED": return "Hay horarios propuestos";
    case "PENDING_SCHEDULE": return "Sin fecha: proponed horarios a vuestros rivales";
    default: return m.scheduledAt ? fmtDateTime(m.scheduledAt) : "";
  }
}

export interface OptionView { id: string; pairId: string; email: string | null; startsAt: string; state: string; createdAt: string; decidedAt: string | null; decidedBy: string | null; origin: string }

/** Horarios propuestos para un partido (solo los ven sus cuatro jugadores y la administración). */
/** Resultados pendientes de confirmar o impugnados de los partidos de unas parejas, en una sola consulta (sin conocer antes los partidos). */
export async function loadOpenSubmissionsForPairs(sb: SB, pairIds: string[]) {
  const out = new Map<string, any>();
  if (pairIds.length === 0) return out;
  const list = pairIds.join(",");
  const { data } = await sb
    .from("result_submissions").select("*, matches!inner(pair_a_id, pair_b_id)")
    .in("status", ["SUBMITTED", "DISPUTED"]).or(`pair_a_id.in.(${list}),pair_b_id.in.(${list})`, { referencedTable: "matches" })
    .order("submitted_at", { ascending: false });
  for (const row of (data ?? []) as any[]) if (!out.has(row.match_id)) { const { matches: _m, ...sub } = row; out.set(row.match_id, sub); }
  return out;
}

/** Avisos sin leer del usuario. Se calcula una sola vez por petición aunque lo pidan la cabecera y la pantalla. */
export const unreadCount = cache(async (sb: SB): Promise<number> => {
  const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
});

export async function loadOptions(sb: SB, matchId: string): Promise<OptionView[]> {
  const { data, error } = await sb.from("match_date_options").select("*").eq("match_id", matchId).order("created_at").order("starts_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((o) => ({
    id: o.id, pairId: o.proposed_by_pair, email: o.proposed_by_email, startsAt: o.starts_at, state: o.state,
    createdAt: o.created_at, decidedAt: o.decided_at, decidedBy: o.decided_by_email, origin: o.origin ?? "MANUAL",
  }));
}

export async function loadNotifications(sb: SB, limit = 50) {
  const { data } = await sb.from("notifications").select("id, match_id, kind, title, body, created_at, read_at").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as { id: string; match_id: string | null; kind: string; title: string; body: string | null; created_at: string; read_at: string | null }[];
}

export const setsText = (sets: SetScore[]) => sets.map((s) => `${s.a}-${s.b}`).join("  ");

/** Resultado enviado y pendiente de respuesta (o impugnado) de cada partido. */
export async function loadOpenSubmissions(sb: SB, matchIds: string[]) {
  if (matchIds.length === 0) return new Map<string, any>();
  const { data } = await sb
    .from("result_submissions").select("*").in("match_id", matchIds).in("status", ["SUBMITTED", "DISPUTED"])
    .order("submitted_at", { ascending: false });
  const out = new Map<string, any>();
  for (const s of data ?? []) if (!out.has((s as any).match_id)) out.set((s as any).match_id, s);
  return out;
}

/** Últimos resultados (confirmados y pendientes de confirmar), más recientes primero. De una categoría o de toda la liga. */
export async function loadRecentResults(sb: SB, seasonId: string, opts: { categoryId?: string; limit?: number } = {}) {
  const ms = await loadMatches(sb, seasonId, { categoryId: opts.categoryId, statuses: ["COMPLETED", "RESULT_PENDING_CONFIRMATION"] });
  const when = (m: MatchView) => new Date(m.confirmedAt ?? m.updatedAt).getTime();
  return [...ms].sort((a, b) => when(b) - when(a)).slice(0, opts.limit ?? 10);
}

// ---------- Grupos ----------

export async function loadGroups(sb: SB, phaseId: string) {
  const { data, error } = await sb.from("groups").select("id, letter, category_id, group_pairs(pair_id)").eq("phase_id", phaseId).order("letter");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((g) => ({
    id: g.id as string, letter: g.letter as string, categoryId: g.category_id as string,
    pairIds: ((g.group_pairs ?? []) as any[]).map((x) => x.pair_id as string),
  }));
}

/** Rivales ya enfrentados y parejas que ya estuvieron en un grupo de 3, en las demás fases de la categoría. */
export async function loadHistory(sb: SB, seasonId: string, excludePhaseId: string, categoryId: string) {
  const { data } = await sb
    .from("group_pairs")
    .select("group_id, pair_id, groups!inner(category_id), phases!inner(season_id)")
    .eq("phases.season_id", seasonId).eq("groups.category_id", categoryId).neq("phase_id", excludePhaseId).limit(5000);
  const byGroup = new Map<string, string[]>();
  for (const r of (data ?? []) as any[]) byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r.pair_id]);
  const history = new Set<string>(), small = new Set<string>();
  for (const members of byGroup.values()) {
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) history.add(pairKey(members[i], members[j]));
    if (members.length === 3) members.forEach((m) => small.add(m));
  }
  return { history, small };
}

/** Igual que loadHistory pero de todas las categorías en una sola consulta (para la pantalla de Grupos). */
export async function loadHistoryAll(sb: SB, seasonId: string, excludePhaseId: string) {
  const { data } = await sb
    .from("group_pairs")
    .select("group_id, pair_id, groups!inner(category_id), phases!inner(season_id)")
    .eq("phases.season_id", seasonId).neq("phase_id", excludePhaseId).limit(10000);
  const byGroup = new Map<string, { cat: string; members: string[] }>();
  for (const r of (data ?? []) as any[]) {
    const g = byGroup.get(r.group_id) ?? { cat: one<any>(r.groups).category_id as string, members: [] };
    g.members.push(r.pair_id);
    byGroup.set(r.group_id, g);
  }
  const out = new Map<string, { history: Set<string>; small: Set<string> }>();
  for (const { cat, members } of byGroup.values()) {
    const h = out.get(cat) ?? { history: new Set<string>(), small: new Set<string>() };
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) h.history.add(pairKey(members[i], members[j]));
    if (members.length === 3) members.forEach((m) => h.small.add(m));
    out.set(cat, h);
  }
  return out;
}

// ---------- Clasificaciones ----------

export interface Quota { up: number; down: number; status: "PLANNED" | "CONFIRMED" }

export async function categoryStandings(sb: SB, season: SeasonRow, categoryId: string, opts: { provisional?: boolean } = {}) {
  const [pairs, matches, quotaRes] = await Promise.all([
    loadPairs(sb, season.id, { categoryId }),
    loadMatches(sb, season.id, { categoryId, maxPhaseNumber: 3 }),
    sb.from("category_quotas").select("up, down, status").eq("season_id", season.id).eq("category_id", categoryId).maybeSingle(),
  ]);
  const active = pairs.filter((p) => p.status === "ACTIVE");
  const rows: StandingRow[] = levelingStandings(active.map((p) => p.id), matches.map(toRecord), {
    provisional: opts.provisional, rules: mergeRules(season.rules),
  });
  const quota = quotaRes.data && (quotaRes.data.up > 0 || quotaRes.data.down > 0) ? (quotaRes.data as Quota) : null;
  return { rows, quota, pairs: pairMap(pairs), matches };
}

// ---------- Ranking individual ----------

export interface RankingRow { playerId: string; name: string; points: number; wins: number; losses: number }

export async function loadRanking(sb: SB, season: SeasonRow, cats: Cat[], division: Division): Promise<RankingRow[]> {
  const divisionId = cats.find((c) => c.division === division)?.divisionId;
  if (!divisionId) return [];
  const catIds = new Set(cats.filter((c) => c.division === division).map((c) => c.id));
  const [pairs, evRes, matches] = await Promise.all([
    loadPairs(sb, season.id),
    sb.from("ranking_events").select("kind, player_id, points, movement, at, idempotency_key").eq("division_id", divisionId).limit(5000),
    loadMatches(sb, season.id, { statuses: ["COMPLETED"] }),
  ]);
  const pmap = pairMap(pairs);
  const names = new Map<string, string>();
  pairs.filter((p) => catIds.has(p.categoryId)).forEach((p) => p.players.forEach((pl) => names.set(pl.id, pl.name)));

  const iso = (s: string) => new Date(s).toISOString();
  const events: RankingEvent[] = [];
  for (const e of (evRes.data ?? []) as any[]) {
    if (e.kind === "INITIAL") events.push({ kind: "INITIAL", at: iso(e.at), playerId: e.player_id, points: Number(e.points), key: e.idempotency_key });
    else if (e.kind === "BONUS") events.push({ kind: "BONUS", at: iso(e.at), playerIds: [e.player_id], movement: e.movement ?? "STAY", points: Number(e.points), key: e.idempotency_key });
    else events.push({ kind: "ADJUSTMENT", at: iso(e.at), playerId: e.player_id, points: Number(e.points), reason: "", key: e.idempotency_key });
  }
  for (const m of matches) {
    if (!catIds.has(m.categoryId) || !m.winner) continue;
    const a = pmap.get(m.pairA), b = pmap.get(m.pairB);
    if (!a || !b || a.players.length !== 2 || b.players.length !== 2) continue;
    const [w, l] = m.winner === "A" ? [a, b] : [b, a];
    events.push({
      kind: "MATCH", at: iso(m.confirmedAt ?? m.updatedAt), matchId: m.id, key: `m:${m.id}`,
      winners: [w.players[0].id, w.players[1].id], losers: [l.players[0].id, l.players[1].id],
    });
  }
  const { balances, ledger } = replayRanking(events, mergeRules(season.rules));
  const wins = new Map<string, number>(), losses = new Map<string, number>();
  for (const l of ledger) if (l.kind === "MATCH") (l.delta > 0 ? wins : losses).set(l.playerId, ((l.delta > 0 ? wins : losses).get(l.playerId) ?? 0) + 1);
  return [...balances.entries()]
    .map(([playerId, points]) => ({ playerId, name: names.get(playerId) ?? "—", points, wins: wins.get(playerId) ?? 0, losses: losses.get(playerId) ?? 0 }))
    .sort((x, y) => y.points - x.points || x.name.localeCompare(y.name, "es"));
}

// ---------- Utilidades de texto ----------

export function groupsText(n: number): string {
  if (n === 0) return "Sin parejas";
  const { sizes } = groupSizes(n);
  if (n < 3) return "Faltan parejas para formar un grupo";
  const count = (k: number) => sizes.filter((x) => x === k).length;
  return [4, 3, 5].filter((k) => count(k) > 0).map((k) => `${count(k)} ${count(k) === 1 ? "grupo" : "grupos"} de ${k}`).join(" y ");
}

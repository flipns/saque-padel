"use server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, must } from "@/lib/flash";
import { notifyPairs } from "@/lib/notify";
import { parseSets, SCORE_ERRORS, str } from "@/lib/form";
import { fmtDateTime, madridToIso } from "@/lib/dates";
import { matchWinner, mergeRules, validateScore, type SetScore, type Side } from "@/lib/engine";
import { getSeasonRow, loadMatches, loadPairs, pairName, setsText, type MatchView } from "@/lib/data";

async function auth(id: string) {
  const path = `/admin/partidos/${id}`;
  const { sb, user } = await requireAdmin(path);
  return { path, sb, user };
}
type SB = Awaited<ReturnType<typeof auth>>["sb"];

async function load(sb: SB, id: string) {
  const season = await getSeasonRow(sb);
  if (!season) throw new Error("No hay temporada activa");
  const m = (await loadMatches(sb, season.id, { id }))[0];
  if (!m) throw new Error("Partido no encontrado");
  return { season, m };
}

/** Avisa a las dos parejas de lo que ha decidido la organización. El texto recibe los nombres de la pareja A y la B. */
async function tell(sb: SB, seasonId: string, m: MatchView, kind: string, title: string, body: (a: string, b: string) => string) {
  const pairs = await loadPairs(sb, seasonId, { ids: [m.pairA, m.pairB] });
  const name = (id: string) => pairName(pairs.find((p) => p.id === id));
  await notifyPairs(sb, [m.pairA, m.pairB], { matchId: m.id, kind, title, body: body(name(m.pairA), name(m.pairB)) });
}

async function closeSubmissions(sb: SB, matchId: string, status: "ADMIN_RESOLVED" | "SUPERSEDED", note?: string) {
  must(await sb.from("result_submissions").update({ status, resolution_note: note ?? null, responded_at: new Date().toISOString() })
    .eq("match_id", matchId).in("status", ["SUBMITTED", "DISPUTED"]));
}

async function applyResult(sb: any, season: any, matchId: string, sets: SetScore[], endedByTime: boolean, manualWinner: string) {
  const bad = validateScore(sets, endedByTime);
  if (bad) throw new Error(SCORE_ERRORS[bad] ?? "Marcador no válido");
  let winner: Side | null = matchWinner(sets, endedByTime);
  if (!winner) {
    if (manualWinner === "A" || manualWinner === "B") winner = manualWinner;
    else throw new Error("Empate absoluto al acabar el tiempo: elige qué pareja gana.");
  }
  must(await sb.from("matches").update({
    status: "COMPLETED", sets, ended_by_time: endedByTime, winner_side: winner, points_override: null,
    confirmed_at: new Date().toISOString(), ruleset: mergeRules(season.rules), updated_at: new Date().toISOString(),
  }).eq("id", matchId));
  return winner;
}

/** El admin fija el resultado definitivo (también sirve para resolver una impugnación). */
export async function setResultAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { season, m } = await load(sb, id);
    const sets = parseSets(form);
    const winner = await applyResult(sb, season, id, sets, form.get("time") === "on", str(form, "winner"));
    await closeSubmissions(sb, id, "ADMIN_RESOLVED", "Resultado fijado por la organización");
    await audit(sb, user.email, "RESULT_SET_BY_ADMIN", "match", id, { sets, winner }, `Antes: ${m.status}`);
    await tell(sb, season.id, m, "ADMIN_RESULT", "Resultado fijado por la organización", (a, b) => `${a} ${setsText(sets)} ${b}. Ya cuenta para la clasificación y el ranking.`);
    return "Resultado guardado. La clasificación y el ranking ya lo incluyen.";
  });
}

/** Da por bueno el resultado que envió una pareja (sin esperar las 48 h o tras una impugnación). */
export async function acceptSubmittedAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { season, m } = await load(sb, id);
    const sub = must(await sb.from("result_submissions").select("*").eq("match_id", id).in("status", ["SUBMITTED", "DISPUTED"]).order("submitted_at", { ascending: false }).limit(1)) as any[];
    if (!sub[0]) throw new Error("No hay ningún resultado enviado pendiente.");
    const winner = await applyResult(sb, season, id, sub[0].sets, sub[0].ended_by_time, sub[0].winner_side);
    await closeSubmissions(sb, id, "ADMIN_RESOLVED", "Resultado enviado validado por la organización");
    await audit(sb, user.email, "SUBMISSION_ACCEPTED_BY_ADMIN", "match", id, { sets: sub[0].sets, winner });
    await tell(sb, season.id, m, "ADMIN_RESULT", "Resultado validado por la organización", (a, b) => `${a} ${setsText(sub[0].sets)} ${b}. Ya cuenta para la clasificación y el ranking.`);
    return "Resultado enviado validado.";
  });
}

/** Da por buena la versión del resultado que propuso la pareja que impugnó. */
export async function acceptDisputeVersionAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { season, m } = await load(sb, id);
    const sub = must(await sb.from("result_submissions").select("*").eq("match_id", id).eq("status", "DISPUTED").order("submitted_at", { ascending: false }).limit(1)) as any[];
    if (!sub[0] || !sub[0].dispute_sets) throw new Error("La pareja que impugnó no propuso ninguna versión.");
    const winner = await applyResult(sb, season, id, sub[0].dispute_sets, sub[0].dispute_ended_by_time, str(form, "winner"));
    await closeSubmissions(sb, id, "ADMIN_RESOLVED", "Versión de la pareja que impugnó validada por la organización");
    await audit(sb, user.email, "DISPUTE_VERSION_ACCEPTED_BY_ADMIN", "match", id, { sets: sub[0].dispute_sets, winner });
    await tell(sb, season.id, m, "ADMIN_RESULT", "Resultado validado por la organización", (a, b) => `${a} ${setsText(sub[0].dispute_sets)} ${b}. Se ha dado por buena la versión de la pareja que impugnó. Ya cuenta para la clasificación y el ranking.`);
    return "Versión de la pareja que impugnó validada.";
  });
}

/** WO aprobado: por defecto −1 a la pareja responsable y 0 a la otra; el admin puede cambiar los puntos. */
export async function woAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { season, m } = await load(sb, id);
    const reason = str(form, "reason");
    if (!reason) throw new Error("Escribe el motivo del WO.");
    const resp = str(form, "responsible");
    if (resp !== "A" && resp !== "B") throw new Error("Elige la pareja responsable del WO.");
    const pa = Number(str(form, "pointsA")), pb = Number(str(form, "pointsB"));
    if (!Number.isFinite(pa) || !Number.isFinite(pb)) throw new Error("Los puntos deben ser números.");
    must(await sb.from("matches").update({
      status: "WO", sets: [], winner_side: null, ended_by_time: false, points_override: { a: pa, b: pb },
      confirmed_at: new Date().toISOString(), ruleset: mergeRules(season.rules), updated_at: new Date().toISOString(),
    }).eq("id", id));
    must(await sb.from("wo_resolutions").upsert({
      match_id: id, responsible_pair_id: resp === "A" ? m.pairA : m.pairB, points_a: pa, points_b: pb,
      counts_as_incident: form.get("incident") === "on", reason, decided_by: user.email,
    }, { onConflict: "match_id" }));
    await closeSubmissions(sb, id, "ADMIN_RESOLVED", "WO");
    await audit(sb, user.email, "WO_APPLIED", "match", id, { pa, pb, responsible: resp }, reason);
    await tell(sb, season.id, m, "ADMIN_WO", "WO registrado en vuestro partido", (a, b) => `La organización ha registrado un WO en ${a} contra ${b}. Motivo: ${reason}`);
    return "WO registrado.";
  });
}

export async function notPlayedAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { season, m } = await load(sb, id);
    const reason = str(form, "reason");
    if (!reason) throw new Error("Escribe el motivo.");
    const z = mergeRules(season.rules).matchPoints.notPlayed;
    must(await sb.from("matches").update({
      status: "NOT_PLAYED", sets: [], winner_side: null, ended_by_time: false, points_override: { a: z, b: z },
      confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", id));
    await closeSubmissions(sb, id, "ADMIN_RESOLVED", "No disputado");
    await audit(sb, user.email, "MATCH_NOT_PLAYED", "match", id, null, reason);
    await tell(sb, season.id, m, "ADMIN_NOT_PLAYED", "Partido marcado como no disputado", (a, b) => `La organización ha marcado como no disputado ${a} contra ${b} (0 puntos para ambas parejas). Motivo: ${reason}`);
    return "Partido marcado como no disputado (0 puntos para ambas parejas).";
  });
}

/** Deja el partido como al principio: sin resultado y con su fecha si la tenía. */
export async function resetAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { m } = await load(sb, id);
    must(await sb.from("matches").update({
      status: m.scheduledAt ? "SCHEDULED" : "PENDING_SCHEDULE", sets: [], winner_side: null, ended_by_time: false,
      points_override: null, confirmed_at: null, updated_at: new Date().toISOString(),
    }).eq("id", id));
    must(await sb.from("wo_resolutions").delete().eq("match_id", id));
    await closeSubmissions(sb, id, "SUPERSEDED", "Restablecido por la organización");
    await audit(sb, user.email, "MATCH_RESET", "match", id, null, `Antes: ${m.status}`);
    return "Partido restablecido: ya no tiene resultado.";
  });
}

export async function scheduleAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { season, m } = await load(sb, id);
    const date = str(form, "date"), time = str(form, "time") || "18:00", court = str(form, "court");
    const at = date ? madridToIso(date, time) : null;
    const patch: Record<string, unknown> = { scheduled_at: at, court: court || null, updated_at: new Date().toISOString() };
    if (["PENDING_SCHEDULE", "SCHEDULE_PROPOSED", "SCHEDULED", "DATE_AGREED", "RESCHEDULE_REQUESTED"].includes(m.status)) {
      patch.status = at ? "SCHEDULED" : "PENDING_SCHEDULE";
      patch.agreed_option_id = null; patch.agreed_start_at = null;
      // La fecha fijada por la organización sustituye a cualquier negociación en curso.
      must(await sb.from("match_date_options").update({ state: "SUPERSEDED" }).eq("match_id", id).in("state", ["ACTIVE", "ACCEPTED"]));
    }
    must(await sb.from("matches").update(patch).eq("id", id));
    await audit(sb, user.email, "SCHEDULE_SET_BY_ADMIN", "match", id, { at, court });
    if (at) await tell(sb, season.id, m, "ADMIN_SCHEDULE", "La organización ha fijado la fecha de vuestro partido", (a, b) => `${a} contra ${b}: ${fmtDateTime(at)}${court ? ` · ${court}` : ""}.`);
    return at ? "Fecha y pista guardadas." : "Fecha quitada.";
  });
}

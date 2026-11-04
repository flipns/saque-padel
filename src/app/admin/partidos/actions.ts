"use server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, must } from "@/lib/flash";
import { parseSets, SCORE_ERRORS, str } from "@/lib/form";
import { madridToIso } from "@/lib/dates";
import { matchWinner, mergeRules, validateScore, type SetScore, type Side } from "@/lib/engine";
import { getSeasonRow, loadMatches } from "@/lib/data";

async function auth(id: string) {
  const path = `/admin/partidos/${id}`;
  const { sb, user } = await requireAdmin(path);
  return { path, sb, user };
}
async function load(sb: Awaited<ReturnType<typeof auth>>["sb"], id: string) {
  const season = await getSeasonRow(sb);
  if (!season) throw new Error("No hay temporada activa");
  const m = (await loadMatches(sb, season.id, { id }))[0];
  if (!m) throw new Error("Partido no encontrado");
  return { season, m };
}

async function closeSubmissions(sb: Awaited<ReturnType<typeof auth>>["sb"], matchId: string, status: "ADMIN_RESOLVED" | "SUPERSEDED", note?: string) {
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
    return "Resultado guardado. La clasificación y el ranking ya lo incluyen.";
  });
}

/** Da por bueno el resultado que envió una pareja (sin esperar las 48 h o tras una impugnación). */
export async function acceptSubmittedAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { season } = await load(sb, id);
    const sub = must(await sb.from("result_submissions").select("*").eq("match_id", id).in("status", ["SUBMITTED", "DISPUTED"]).order("submitted_at", { ascending: false }).limit(1)) as any[];
    if (!sub[0]) throw new Error("No hay ningún resultado enviado pendiente.");
    const winner = await applyResult(sb, season, id, sub[0].sets, sub[0].ended_by_time, sub[0].winner_side);
    await closeSubmissions(sb, id, "ADMIN_RESOLVED", "Resultado enviado validado por la organización");
    await audit(sb, user.email, "SUBMISSION_ACCEPTED_BY_ADMIN", "match", id, { sets: sub[0].sets, winner });
    return "Resultado enviado validado.";
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
    return "WO registrado.";
  });
}

export async function notPlayedAction(form: FormData) {
  const id = str(form, "match");
  const { path, sb, user } = await auth(id);
  await run(path, async () => {
    const { season } = await load(sb, id);
    const reason = str(form, "reason");
    if (!reason) throw new Error("Escribe el motivo.");
    const z = mergeRules(season.rules).matchPoints.notPlayed;
    must(await sb.from("matches").update({
      status: "NOT_PLAYED", sets: [], winner_side: null, ended_by_time: false, points_override: { a: z, b: z },
      confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", id));
    await closeSubmissions(sb, id, "ADMIN_RESOLVED", "No disputado");
    await audit(sb, user.email, "MATCH_NOT_PLAYED", "match", id, null, reason);
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
    const { m } = await load(sb, id);
    const date = str(form, "date"), time = str(form, "time") || "18:00", court = str(form, "court");
    const at = date ? madridToIso(date, time) : null;
    const patch: Record<string, unknown> = { scheduled_at: at, court: court || null, updated_at: new Date().toISOString() };
    if (["PENDING_SCHEDULE", "SCHEDULE_PROPOSED", "SCHEDULED"].includes(m.status)) patch.status = at ? "SCHEDULED" : "PENDING_SCHEDULE";
    must(await sb.from("matches").update(patch).eq("id", id));
    await audit(sb, user.email, "SCHEDULE_SET_BY_ADMIN", "match", id, { at, court });
    return at ? "Fecha y pista guardadas." : "Fecha quitada.";
  });
}

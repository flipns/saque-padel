"use server";
import { requirePlayer } from "@/lib/auth";
import { run, must } from "@/lib/flash";
import { parseSets, SCORE_ERRORS, str } from "@/lib/form";
import { madridToIso } from "@/lib/dates";
import { matchWinner, validateScore } from "@/lib/engine";
import { getSeasonRow, loadMatches } from "@/lib/data";

async function mine(id: string) {
  const path = `/mi-liga/partido/${id}`;
  const { sb, pairIds } = await requirePlayer(path);
  const season = await getSeasonRow(sb);
  if (!season) throw new Error("No hay temporada activa");
  const m = (await loadMatches(sb, season.id, { id }))[0];
  if (!m || !(pairIds.includes(m.pairA) || pairIds.includes(m.pairB))) throw new Error("Este partido no es tuyo.");
  return { path, sb, m, side: (pairIds.includes(m.pairA) ? "A" : "B") as "A" | "B" };
}

/** La pareja ganadora introduce el marcador (visto desde su lado: «nosotros» a la izquierda). */
export async function submitResultAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  await run(path, async () => {
    const { sb, side } = await mine(id);
    let sets = parseSets(form);
    if (side === "B") sets = sets.map((s) => ({ a: s.b, b: s.a })); // se guarda siempre como pareja A – pareja B
    const ended = form.get("time") === "on";
    const bad = validateScore(sets, ended);
    if (bad) throw new Error(SCORE_ERRORS[bad] ?? "Marcador no válido");
    const winner = matchWinner(sets, ended);
    if (!winner) throw new Error("Empate absoluto al acabar el tiempo: avisa a la organización para que lo resuelva.");
    if (winner !== side) throw new Error("Según este marcador gana vuestro rival. Solo la pareja ganadora introduce el resultado: revisa los números.");
    must(await sb.rpc("submit_result", { p_match: id, p_sets: sets, p_ended_by_time: ended, p_winner_side: winner }));
    return "Resultado enviado. Vuestros rivales tienen 48 horas para confirmarlo; si no responden, se da por bueno.";
  });
}

export async function respondAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  await run(path, async () => {
    const { sb } = await mine(id);
    const accept = str(form, "decision") === "accept";
    must(await sb.rpc("respond_result", { p_submission: str(form, "submission"), p_accept: accept, p_reason: accept ? null : str(form, "reason") }));
    return accept ? "Resultado confirmado." : "Resultado impugnado. La organización decidirá.";
  });
}

export async function scheduleAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  await run(path, async () => {
    const { sb } = await mine(id);
    const date = str(form, "date"), time = str(form, "time") || "18:00";
    const at = date ? madridToIso(date, time) : null;
    must(await sb.rpc("set_schedule", { p_match: id, p_at: at, p_court: str(form, "court") || null }));
    return at ? "Fecha y pista guardadas. Vuestros rivales lo verán en su partido." : "Fecha quitada.";
  });
}

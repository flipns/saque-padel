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

// ---------- Coordinación de fecha ----------

/** Lee hasta 5 filas día + hora (campos d1..d5, t1..t5) y las convierte a instantes (hora de Madrid). */
function timesFrom(form: FormData): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const d = str(form, `d${i}`), t = str(form, `t${i}`);
    if (!d && !t) continue;
    if (!d || !t) throw new Error(`Completa el día y la hora del horario ${i}.`);
    out.push(madridToIso(d, t));
  }
  if (out.length === 0) throw new Error("Indica al menos un día y una hora.");
  return out;
}

/** Propone horarios. Con replace=1 se cierran antes los de la otra pareja («ninguno me cuadra»). */
export async function proposeAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    const replace = str(form, "replace") === "1";
    must(await sb.rpc("propose_dates", { p_match: id, p_times: timesFrom(form), p_replace: replace }));
    return replace ? "Propuesta enviada. Los horarios anteriores de vuestros rivales se han cerrado." : "Propuesta enviada. Vuestros rivales verán los horarios y podrán aceptar uno.";
  });
}

export async function respondOptionAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    const accept = str(form, "decision") === "accept";
    must(await sb.rpc("respond_option", { p_option: str(form, "option"), p_accept: accept }));
    return accept ? "Fecha acordada. Ahora hay que reservar la pista y apuntarla aquí." : "Horario rechazado.";
  });
}

export async function withdrawOptionAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    must(await sb.rpc("withdraw_option", { p_option: str(form, "option") }));
    return "Horario retirado.";
  });
}

/** Registra la pista reservada (el partido pasa a «Programado») o corrige pista y referencia. */
export async function bookingAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    must(await sb.rpc("register_booking", { p_match: id, p_court: str(form, "court"), p_ref: str(form, "ref") || null }));
    return "Pista registrada. Se avisa a los cuatro jugadores.";
  });
}

/** «Cambiar fecha» (por ejemplo, porque no hay pista). La fecha y pista anteriores siguen vigentes hasta un nuevo acuerdo. */
export async function changeDateAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    must(await sb.rpc("request_new_date", { p_match: id, p_reason: str(form, "reason") || null }));
    return "Cambio de fecha iniciado. Proponed nuevos horarios; mientras tanto sigue vigente la fecha anterior, si había.";
  });
}

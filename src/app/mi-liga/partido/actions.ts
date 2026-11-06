"use server";
import { requirePlayer } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
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
    const { sb, side } = await mine(id);
    const accept = str(form, "decision") === "accept";
    let sets: { a: number; b: number }[] | null = null, ended = false;
    if (!accept) {
      // Quien impugna puede proponer el resultado exacto (opcional): la organización lo revisará junto con el enviado.
      const raw = parseSets(form);
      if (raw.length > 0) {
        sets = side === "B" ? raw.map((x) => ({ a: x.b, b: x.a })) : raw;   // se guarda siempre como pareja A – pareja B
        ended = form.get("time") === "on";
        const bad = validateScore(sets, ended);
        if (bad) throw new Error(SCORE_ERRORS[bad] ?? "Marcador no válido");
      }
    }
    must(await sb.rpc("respond_result", { p_submission: str(form, "submission"), p_accept: accept, p_reason: accept ? null : str(form, "reason"), p_sets: sets, p_ended_by_time: ended }));
    return accept ? "Resultado confirmado." : sets ? "Resultado impugnado con vuestra versión. La organización revisará las dos y decidirá." : "Resultado impugnado. La organización decidirá.";
  });
}

/** Retira el resultado que enviaste (mientras la otra pareja no lo haya confirmado). El partido vuelve a estar sin resultado. */
export async function withdrawResultAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  await run(path, async () => {
    const { sb } = await mine(id);
    must(await sb.rpc("withdraw_result", { p_match: id }));
    return "Resultado retirado. Cuando lo tengáis claro, enviad el correcto.";
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

/** «¿Quién eres?» desde el propio chat: vincula el email con el jugador y vuelve al partido. */
export async function claimHereAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    must(await sb.rpc("claim_identity", { p_pair: str(form, "pair"), p_player: str(form, "player") }));
    return "Listo, ya puedes escribir en el chat.";
  });
}

/** Propone los horarios elegidos entre las sugerencias del cruce de calendarios (los marca como «sugeridos»). */
export async function proposeSuggestionsAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    const picked = [...new Set(form.getAll("s").map((v) => String(v)).filter(Boolean))];   // un horario puede salir en «Recomendados» y en su día
    if (picked.length === 0) throw new Error("Elige al menos un horario de la lista.");
    if (picked.length > 5) throw new Error("Máximo 5 horarios por propuesta: quita alguno.");
    const times = picked.map((t) => { const d = new Date(t); if (Number.isNaN(d.getTime())) throw new Error("Horario no válido."); return d.toISOString(); });
    const replace = str(form, "replace") === "1";
    must(await sb.rpc("propose_dates", { p_match: id, p_times: times, p_replace: replace }));
    // Se deja constancia de que salen del cruce de calendarios. Un fallo aquí no afecta a la propuesta, que ya está hecha.
    try { await supabaseAdmin().from("match_date_options").update({ origin: "AVAILABILITY" }).eq("match_id", id).eq("state", "ACTIVE").in("starts_at", times); }
    catch (e) { console.error("origin update failed", e); }
    return replace ? "Propuesta enviada. Los horarios anteriores de vuestros rivales se han cerrado." : "Propuesta enviada. Vuestros rivales verán los horarios y podrán aceptar uno.";
  });
}

/** Avisa a los otros jugadores de que actualicen su disponibilidad (como mucho una vez al día por partido). */
export async function requestAvailabilityAction(form: FormData) {
  const id = str(form, "match");
  const path = `/mi-liga/partido/${id}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    const n = must(await sb.rpc("request_availability_update", { p_match: id })) as number | null;
    return n && n > 0 ? "Aviso enviado: les hemos pedido que actualicen su disponibilidad." : "Ya se les avisó hoy. Podéis hablarlo en el chat.";
  });
}

"use server";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { flushEmails } from "@/lib/email";
import { audit } from "@/lib/audit";
import { run, must } from "@/lib/flash";
import { str } from "@/lib/form";
import { generateGroups, groupLetter, roundRobin, pairKey } from "@/lib/engine";
import { getSeasonRow, loadCats, loadPairs, loadPhases, loadHistory, loadGroups, pairName, pairMap } from "@/lib/data";

async function auth(n: number) {
  const path = `/admin/fases/${n}`;
  const { sb, user } = await requireAdmin(path);
  return { path, sb, user };
}

async function load(sb: Awaited<ReturnType<typeof auth>>["sb"], n: number) {
  const season = await getSeasonRow(sb);
  if (!season) throw new Error("No hay temporada activa");
  const phase = (await loadPhases(sb, season.id)).find((p) => p.number === n);
  if (!phase) throw new Error("Fase no encontrada");
  return { season, phase };
}

const editable = (status: string) => status === "DRAFT" || status === "GENERATED";

/** Genera (o regenera) los grupos de una categoría o de todas. No toca fases publicadas. */
export async function generateAction(form: FormData) {
  const n = Number(form.get("phase"));
  const catId = str(form, "cat");
  const { path, sb, user } = await auth(n);
  await run(path, async () => {
    const { season, phase } = await load(sb, n);
    if (phase.kind !== "LEVELING") throw new Error("Los grupos jerárquicos de la Race se generan al cerrar enero.");
    if (!editable(phase.status)) throw new Error("La fase ya está publicada. Vuelve a borrador para regenerar los grupos.");
    const cats = (await loadCats(sb, season.id)).filter((c) => !catId || c.id === catId);
    const pairs = (await loadPairs(sb, season.id)).filter((p) => p.status === "ACTIVE");
    const notes: string[] = [];
    let made = 0, lastSeed = 0;
    for (const cat of cats) {
      const ids = pairs.filter((p) => p.categoryId === cat.id).map((p) => p.id);
      if (ids.length < 3) { notes.push(`${cat.label}: hacen falta al menos 3 parejas`); continue; }
      const { history, small } = await loadHistory(sb, season.id, phase.id, cat.id);
      lastSeed = Math.floor(Math.random() * 2_000_000_000);
      const res = generateGroups({ pairIds: ids, history, hadSmallGroup: small, seed: lastSeed, restarts: 150 });
      must(await sb.from("groups").delete().eq("phase_id", phase.id).eq("category_id", cat.id));
      const inserted = must(await sb.from("groups").insert(res.groups.map((_, i) => ({ phase_id: phase.id, category_id: cat.id, letter: groupLetter(i) }))).select("id, letter")) as any[];
      const idByLetter = new Map(inserted.map((g) => [g.letter as string, g.id as string]));
      must(await sb.from("group_pairs").insert(res.groups.flatMap((g, i) => g.map((pid) => ({ group_id: idByLetter.get(groupLetter(i)), phase_id: phase.id, pair_id: pid })))));
      if (res.repeatedRivals.length) notes.push(`${cat.label}: ${res.repeatedRivals.length} rivales repetidos (inevitable con tan pocas parejas)`);
      made++;
    }
    if (made === 0 && notes.length) throw new Error(notes.join(". "));
    must(await sb.from("phases").update({ status: "GENERATED", generator_seed: lastSeed }).eq("id", phase.id));
    await audit(sb, user.email, "GROUPS_GENERATED", "phase", phase.id, { categories: made, seed: lastSeed });
    return `Grupos generados en ${made} ${made === 1 ? "categoría" : "categorías"}.${notes.length ? " " + notes.join(". ") + "." : ""}`;
  });
}

/** Mueve una pareja a otro grupo de su misma categoría (solo antes de publicar). */
export async function moveAction(form: FormData) {
  const n = Number(form.get("phase"));
  const { path, sb, user } = await auth(n);
  await run(path, async () => {
    const { phase } = await load(sb, n);
    const pairId = str(form, "pair"), to = str(form, "to");
    if (!to) throw new Error("Elige el grupo de destino.");

    // Fase con grupos ya publicados: la operación entera (retirar los partidos sin resultado, cambiar de grupo,
    // crear los partidos nuevos y avisar) la hace la base de datos de una sola vez, para que no pueda quedar a medias.
    if (["PUBLISHED", "ACTIVE"].includes(phase.status)) {
      const r = must(await sb.rpc("admin_move_pair", { p_phase: phase.id, p_pair: pairId, p_to: to })) as { from: string; to: string; cancelled: number; created: number; fromSize: number };
      after(async () => { try { await flushEmails({ limit: 100 }); } catch (e) { console.error("flushEmails failed", e); } });
      const small = r.fromSize < 3 ? ` Ojo: el grupo ${r.from} se queda con ${r.fromSize} ${r.fromSize === 1 ? "pareja" : "parejas"}.` : "";
      return `Pareja movida del grupo ${r.from} al ${r.to}: ${r.cancelled} ${r.cancelled === 1 ? "partido sin jugar cancelado" : "partidos sin jugar cancelados"} y ${r.created} ${r.created === 1 ? "partido nuevo" : "partidos nuevos"}. Se avisa a los jugadores.${small}`;
    }

    if (!editable(phase.status)) throw new Error("La fase ya no admite cambios de grupo.");
    const target = must(await sb.from("groups").select("id, letter, category_id").eq("id", to).single()) as any;
    const pair = must(await sb.from("pairs").select("category_id").eq("id", pairId).single()) as any;
    if (target.category_id !== pair.category_id) throw new Error("Solo se puede mover a un grupo de la misma categoría.");
    must(await sb.from("group_pairs").update({ group_id: to }).eq("phase_id", phase.id).eq("pair_id", pairId));
    await audit(sb, user.email, "GROUP_PAIR_MOVED", "phase", phase.id, { pairId, to });
    return `Pareja movida al grupo ${target.letter}.`;
  });
}

/** Publica la fase: crea todos los partidos (todos contra todos en cada grupo) y los jugadores empiezan a verlos. */
export async function publishAction(form: FormData) {
  const n = Number(form.get("phase"));
  const { path, sb, user } = await auth(n);
  await run(path, async () => {
    const { season, phase } = await load(sb, n);
    if (phase.status !== "GENERATED") throw new Error("Primero hay que generar los grupos.");
    const pairs = await loadPairs(sb, season.id);
    const active = new Set(pairs.filter((p) => p.status === "ACTIVE").map((p) => p.id));
    // Las parejas dadas de baja salen de los grupos.
    const groups = await loadGroups(sb, phase.id);
    const stale = groups.flatMap((g) => g.pairIds.filter((id) => !active.has(id)).map((id) => ({ g: g.id, id })));
    for (const s of stale) must(await sb.from("group_pairs").delete().eq("group_id", s.g).eq("pair_id", s.id));
    const fresh = (await loadGroups(sb, phase.id)).map((g) => ({ ...g, pairIds: g.pairIds.filter((id) => active.has(id)) }));
    const grouped = new Set(fresh.flatMap((g) => g.pairIds));
    const pm = pairMap(pairs);
    const missing = [...active].filter((id) => !grouped.has(id));
    if (missing.length) throw new Error(`Hay parejas sin grupo: ${missing.slice(0, 4).map((id) => pairName(pm.get(id))).join("; ")}${missing.length > 4 ? "…" : ""}. Genera los grupos otra vez.`);
    const tiny = fresh.filter((g) => g.pairIds.length > 0 && g.pairIds.length < 3);
    if (tiny.length) throw new Error(`Hay grupos con menos de 3 parejas (grupo ${tiny.map((g) => g.letter).join(", ")}). Muévelas antes de publicar.`);
    // Grupos vacíos fuera.
    for (const g of fresh.filter((g) => g.pairIds.length === 0)) must(await sb.from("groups").delete().eq("id", g.id));

    const existing = must(await sb.from("matches").select("pair_a_id, pair_b_id").eq("phase_id", phase.id)) as any[];
    const have = new Set(existing.map((m) => pairKey(m.pair_a_id, m.pair_b_id)));
    const rows = fresh.filter((g) => g.pairIds.length >= 3).flatMap((g) =>
      roundRobin(g.pairIds).filter(([a, b]) => !have.has(pairKey(a, b))).map(([a, b]) => ({ phase_id: phase.id, group_id: g.id, pair_a_id: a, pair_b_id: b })));
    for (let i = 0; i < rows.length; i += 200) must(await sb.from("matches").insert(rows.slice(i, i + 200)));
    must(await sb.from("phases").update({ status: "PUBLISHED", published_at: new Date().toISOString() }).eq("id", phase.id));
    await audit(sb, user.email, "PHASE_PUBLISHED", "phase", phase.id, { matches: rows.length });
    // Aviso a todos los jugadores de la fase (dentro de la web y por email). Los emails se envían tras responder.
    const notified = (must(await sb.rpc("notify_phase_published", { p_phase: phase.id })) as number | null) ?? 0;
    after(async () => { try { await flushEmails({ limit: 500 }); } catch (e) { console.error("flushEmails failed", e); } });
    return `Fase publicada: ${rows.length} partidos creados. Los jugadores ya pueden verlos y se les avisa (${notified} avisos).`;
  });
}

/** Vuelve a borrador una fase publicada, solo si todavía no hay ningún resultado ni fecha. */
export async function unpublishAction(form: FormData) {
  const n = Number(form.get("phase"));
  const { path, sb, user } = await auth(n);
  await run(path, async () => {
    const { season, phase } = await load(sb, n);
    if (!["PUBLISHED", "ACTIVE"].includes(phase.status)) throw new Error("La fase no está publicada.");
    const started = must(await sb.from("matches").select("id").eq("phase_id", phase.id).neq("status", "PENDING_SCHEDULE").limit(1)) as any[];
    if (started.length) throw new Error("Ya hay partidos con fecha o resultado: no se puede volver a borrador.");
    must(await sb.from("matches").delete().eq("phase_id", phase.id));
    must(await sb.from("phases").update({ status: "GENERATED", published_at: null }).eq("id", phase.id));
    await audit(sb, user.email, "PHASE_UNPUBLISHED", "phase", phase.id);
    return "La fase vuelve a estar en borrador. Los jugadores ya no ven los partidos.";
  });
}

/** Alta tardía en una fase ya publicada: mete la pareja en un grupo y crea sus partidos contra el resto del grupo. */
export async function addToGroupAction(form: FormData) {
  const n = Number(form.get("phase"));
  const { path, sb, user } = await auth(n);
  await run(path, async () => {
    const { season, phase } = await load(sb, n);
    const pairId = str(form, "pair"), groupId = str(form, "to");
    if (!groupId) throw new Error("Elige el grupo.");
    const already = must(await sb.from("group_pairs").select("group_id").eq("phase_id", phase.id).eq("pair_id", pairId).limit(1)) as any[];
    if (already.length) throw new Error("Esa pareja ya está en un grupo de esta fase.");
    const group = must(await sb.from("groups").select("id, letter, category_id, group_pairs(pair_id)").eq("id", groupId).single()) as any;
    const pair = must(await sb.from("pairs").select("category_id").eq("id", pairId).single()) as any;
    if (group.category_id !== pair.category_id) throw new Error("El grupo debe ser de la misma categoría.");
    const members: string[] = (group.group_pairs ?? []).map((x: any) => x.pair_id);
    must(await sb.from("group_pairs").insert({ group_id: groupId, phase_id: phase.id, pair_id: pairId }));
    if (["PUBLISHED", "ACTIVE"].includes(phase.status) && members.length) {
      must(await sb.from("matches").insert(members.map((m) => ({ phase_id: phase.id, group_id: groupId, pair_a_id: pairId, pair_b_id: m }))));
    }
    await audit(sb, user.email, "GROUP_PAIR_ADDED", "phase", phase.id, { pairId, groupId });
    return `Pareja añadida al grupo ${group.letter}${members.length ? ` con ${members.length} partidos nuevos` : ""}.`;
  });
}

/** Crea un grupo nuevo (vacío) en una categoría, con la primera letra libre (A, B, C…). Después se le añaden las parejas sin grupo. */
export async function createGroupAction(form: FormData) {
  const n = Number(form.get("phase"));
  const cat = str(form, "cat");
  const { path, sb, user } = await auth(n);
  await run(`${path}#cat-${cat}`, async () => {
    const { phase } = await load(sb, n);
    if (phase.kind !== "LEVELING") throw new Error("Los grupos de la Race se crean al cerrar la nivelación.");
    if (!["GENERATED", "PUBLISHED", "ACTIVE"].includes(phase.status)) throw new Error("Primero hay que generar los grupos de la fase.");
    const used = new Set((must(await sb.from("groups").select("letter").eq("phase_id", phase.id).eq("category_id", cat)) as any[]).map((g) => g.letter as string));
    const letter = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).find((l) => !used.has(l));
    if (!letter) throw new Error("Ya hay 26 grupos en esta categoría.");
    must(await sb.from("groups").insert({ phase_id: phase.id, category_id: cat, letter }));
    await audit(sb, user.email, "GROUP_CREATED", "phase", phase.id, { category: cat, letter });
    return `Grupo ${letter} creado. Ahora añade las parejas sin grupo desde esta misma categoría.`;
  });
}

/** Elimina un grupo que no tiene ninguna pareja ni partidos. */
export async function deleteEmptyGroupAction(form: FormData) {
  const n = Number(form.get("phase"));
  const group = str(form, "group");
  const { path, sb, user } = await auth(n);
  await run(path, async () => {
    const { phase } = await load(sb, n);
    const g = must(await sb.from("groups").select("id, letter, category_id, group_pairs(pair_id)").eq("id", group).eq("phase_id", phase.id).single()) as any;
    if ((g.group_pairs ?? []).length > 0) throw new Error("El grupo tiene parejas: solo se pueden eliminar grupos vacíos.");
    const played = must(await sb.from("matches").select("id").eq("group_id", group).limit(1)) as any[];
    if (played.length) throw new Error("El grupo tiene partidos: no se puede eliminar.");
    must(await sb.from("groups").delete().eq("id", group));
    await audit(sb, user.email, "GROUP_DELETED", "phase", phase.id, { letter: g.letter });
    return `Grupo ${g.letter} eliminado.`;
  });
}

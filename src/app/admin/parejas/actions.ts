"use server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { back, run, must } from "@/lib/flash";
import { str } from "@/lib/form";
import { mergeRules } from "@/lib/engine";
import { getSeasonRow, loadCats } from "@/lib/data";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parseEmails(raw: string): string[] {
  const list = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = list.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) throw new Error(`Email no válido: ${bad[0]}`);
  if (list.length === 0) throw new Error("Pon al menos un email: sin él nadie de la pareja podrá entrar.");
  return list;
}
const phone = (s: string) => { const d = s.replace(/[^\d+]/g, ""); return /^[6789]\d{8}$/.test(d) ? `+34${d}` : d; };

export async function updatePairAction(form: FormData) {
  const id = str(form, "pair");
  const path = `/admin/parejas/${id}`;
  const { sb, user } = await requireAdmin(path);
  await run(path, async () => {
    const season = await getSeasonRow(sb);
    if (!season) throw new Error("No hay temporada activa");
    const cats = await loadCats(sb, season.id);
    const pair = must(await sb.from("pairs").select("id, category_id, status, pair_members(slot, player_id)").eq("id", id).single()) as any;
    const oldCat = cats.find((c) => c.id === pair.category_id);
    const newCat = cats.find((c) => c.id === str(form, "category"));
    if (!newCat) throw new Error("Elige una categoría.");
    if (oldCat && newCat.division !== oldCat.division) throw new Error("No se puede pasar una pareja entre divisiones masculina y femenina.");
    const status = str(form, "status");
    if (!["ACTIVE", "WITHDRAWN"].includes(status)) throw new Error("Estado no válido.");
    const emails = parseEmails(str(form, "emails"));

    const members = [...pair.pair_members].sort((a: any, b: any) => a.slot - b.slot);
    for (const [i, m] of members.entries()) {
      const name = str(form, `name${i + 1}`);
      if (!name) throw new Error(`Falta el nombre del jugador ${i + 1}.`);
      must(await sb.from("players").update({ full_name: name, is_minor: form.get(`minor${i + 1}`) === "on" }).eq("id", m.player_id));
      must(await sb.from("player_contacts").upsert({ player_id: m.player_id, phone: phone(str(form, `phone${i + 1}`)) || null }, { onConflict: "player_id" }));
    }
    must(await sb.from("pairs").update({ category_id: newCat.id, status }).eq("id", id));
    must(await sb.from("pair_access").delete().eq("pair_id", id));
    must(await sb.from("pair_access").insert(emails.map((email) => ({ pair_id: id, email }))));
    await audit(sb, user.email, "PAIR_UPDATED", "pair", id, { category: newCat.label, status, emails });
    const notes: string[] = [];
    if (oldCat && oldCat.id !== newCat.id) notes.push("La pareja cambió de categoría: revisa sus grupos en Grupos (no se mueve sola).");
    if (status === "WITHDRAWN") notes.push("Los partidos pendientes de esta pareja siguen creados: márcalos como WO o no disputados.");
    return `Pareja guardada. ${notes.join(" ")}`.trim();
  });
}

export async function createPairAction(form: FormData) {
  const { sb, user } = await requireAdmin("/admin/parejas/nueva");
  let newId = "";
  try {
    const season = await getSeasonRow(sb);
    if (!season) throw new Error("No hay temporada activa");
    const cats = await loadCats(sb, season.id);
    const cat = cats.find((c) => c.id === str(form, "category"));
    if (!cat) throw new Error("Elige una categoría.");
    const emails = parseEmails(str(form, "emails"));
    const names = [str(form, "name1"), str(form, "name2")];
    if (!names[0] || !names[1]) throw new Error("Faltan los nombres de los dos jugadores.");
    const start = mergeRules(season.rules).ranking.startPoints[cat.code as keyof ReturnType<typeof mergeRules>["ranking"]["startPoints"]];

    const playerIds: string[] = [];
    for (const i of [1, 2]) {
      const ph = phone(str(form, `phone${i}`));
      let pid: string | undefined;
      if (ph) {
        const { data } = await sb.from("player_contacts").select("player_id").eq("phone", ph).limit(1);
        pid = (data as any[])?.[0]?.player_id;
      }
      if (!pid) {
        const p = must(await sb.from("players").insert({ full_name: names[i - 1], is_minor: form.get(`minor${i}`) === "on" }).select("id").single()) as any;
        pid = p.id as string;
        must(await sb.from("player_contacts").insert({ player_id: pid, phone: ph || null, email: emails[0] }));
      }
      playerIds.push(pid!);
    }
    if (playerIds[0] === playerIds[1]) throw new Error("Los dos jugadores son la misma persona.");
    const pair = must(await sb.from("pairs").insert({ season_id: season.id, category_id: cat.id, valid_from: new Date().toISOString().slice(0, 10) }).select("id").single()) as any;
    newId = pair.id;
    must(await sb.from("pair_members").insert(playerIds.map((player_id, i) => ({ pair_id: newId, slot: i + 1, player_id }))));
    must(await sb.from("pair_access").insert(emails.map((email) => ({ pair_id: newId, email }))));
    must(await sb.from("ranking_events").upsert(
      playerIds.map((player_id) => ({ division_id: cat.divisionId, player_id, kind: "INITIAL", points: start, reason: `Inicio en ${cat.code}`, idempotency_key: `init:${cat.divisionId}:${player_id}`, created_by: user.email })),
      { onConflict: "idempotency_key", ignoreDuplicates: true }));
    await audit(sb, user.email, "PAIR_CREATED", "pair", newId, { category: cat.label, names });
  } catch (e: any) {
    console.error("createPair failed", e);
    return back("/admin/parejas/nueva", "err", e?.message ?? "No se ha podido crear la pareja");
  }
  return back(`/admin/parejas/${newId}`, "ok", "Pareja creada. Si la fase ya está generada, añádela a un grupo desde Grupos.");
}

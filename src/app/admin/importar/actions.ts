"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_RULES, mergeRules, type ImportedRow } from "@/lib/engine";

export interface ImportResult {
  created: number;
  skipped: { row: number; reason: string }[];
  errors: { row: number; message: string }[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const rowKey = (r: ImportedRow) => [r.division, r.level, ...[norm(r.player1.name), norm(r.player2.name)].sort()].join("|");

/**
 * Crea jugadores, parejas, acceso y puntos iniciales de ranking a partir de las filas revisadas.
 * Es idempotente: una pareja ya importada (misma categoría y mismos nombres) se omite.
 */
export async function commitImport(rows: ImportedRow[]): Promise<ImportResult> {
  const { user } = await requireAdmin();
  const db = supabaseAdmin();
  const result: ImportResult = { created: 0, skipped: [], errors: [] };

  const { data: season } = await db.from("seasons").select("id, rules").eq("is_current", true).single();
  if (!season) throw new Error("No hay temporada activa");
  const rules = mergeRules(season.rules);
  const { data: cats } = await db
    .from("categories")
    .select("id, code, divisions!inner(id, code, season_id)")
    .eq("divisions.season_id", season.id);
  const catId = (div: string, lvl: string) =>
    (cats ?? []).find((c: any) => c.code === lvl && c.divisions.code === div) as any;

  const { data: existing } = await db.from("registrations").select("raw").eq("season_id", season.id);
  const done = new Set((existing ?? []).map((r: any) => r.raw?.key).filter(Boolean));
  const batch = crypto.randomUUID();

  for (const r of rows) {
    if (r.duplicateOf) { result.skipped.push({ row: r.rowNumber, reason: `Sustituida por la fila ${r.duplicateOf}` }); continue; }
    if (!r.division || !r.level) { result.skipped.push({ row: r.rowNumber, reason: "Categoría no reconocida" }); continue; }
    const key = rowKey(r);
    if (done.has(key)) { result.skipped.push({ row: r.rowNumber, reason: "Ya importada" }); continue; }
    const cat = catId(r.division, r.level);
    if (!cat) { result.skipped.push({ row: r.rowNumber, reason: "La categoría no existe en esta temporada" }); continue; }

    try {
      const { data: reg, error: regErr } = await db.from("registrations").insert({
        season_id: season.id, source: "FORM_IMPORT", import_batch: batch, row_number: r.rowNumber,
        submitted_at: parseFormDate(r.submittedAt), email: r.email, category_raw: r.categoryRaw, category_id: cat.id,
        raw: { key, row: r }, status: "CONFIRMED", issues: r.issues,
      }).select("id").single();
      if (regErr) throw regErr;

      const playerIds: string[] = [];
      for (const p of [r.player1, r.player2]) {
        // Reutiliza al jugador si ya existe con el mismo móvil (p. ej. inscrito en otra temporada).
        let id: string | undefined;
        if (p.phone) {
          const { data: c } = await db.from("player_contacts").select("player_id").eq("phone", p.phone).maybeSingle();
          id = c?.player_id;
        }
        if (!id) {
          const { data: np, error } = await db.from("players").insert({ full_name: p.name }).select("id").single();
          if (error) throw error;
          id = np.id as string;
          await db.from("player_contacts").insert({ player_id: id, phone: p.phone || null, email: r.email });
        }
        playerIds.push(id!);
      }

      const { data: pair, error: pairErr } = await db.from("pairs")
        .insert({ season_id: season.id, category_id: cat.id, registration_id: reg.id, valid_from: "2026-11-06" })
        .select("id").single();
      if (pairErr) throw pairErr;
      await db.from("pair_members").insert(playerIds.map((pid, i) => ({ pair_id: pair.id, slot: i + 1, player_id: pid })));
      await db.from("pair_access").upsert({ pair_id: pair.id, email: r.email });
      await db.from("registrations").update({ pair_id: pair.id }).eq("id", reg.id);

      // Puntos iniciales del Ranking General (por división). Solo si el jugador no tiene ya ranking en ella.
      const start = (rules.ranking ?? DEFAULT_RULES.ranking).startPoints[r.level];
      await db.from("ranking_events").upsert(
        playerIds.map((pid) => ({
          division_id: cat.divisions.id, player_id: pid, kind: "INITIAL", points: start,
          reason: `Inicio en ${r.level}`, idempotency_key: `init:${cat.divisions.id}:${pid}`, created_by: user.email,
        })),
        { onConflict: "idempotency_key", ignoreDuplicates: true }
      );

      done.add(key);
      result.created++;
    } catch (e: any) {
      result.errors.push({ row: r.rowNumber, message: e?.message ?? String(e) });
    }
  }

  await db.from("audit_log").insert({
    actor: user.email, action: "IMPORT_REGISTRATIONS", entity: "registrations", entity_id: batch,
    after: { created: result.created, skipped: result.skipped.length, errors: result.errors.length },
  });
  revalidatePath("/admin");
  return result;
}

/** Google Forms exporta "30/10/2026 10:15:00". Se interpreta en hora de Madrid. */
function parseFormDate(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h, mi, se = "0"] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${se.padStart(2, "0")}`;
  // Noviembre a marzo es horario de invierno (+01:00); suficiente para la fecha de inscripción.
  return `${iso}+01:00`;
}

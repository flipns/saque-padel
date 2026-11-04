"use server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, must } from "@/lib/flash";
import { str } from "@/lib/form";
import { getSeasonRow } from "@/lib/data";

export async function saveQuotaAction(form: FormData) {
  const cat = str(form, "cat");
  const path = `/admin/clasificacion?cat=${cat}`;
  const { sb, user } = await requireAdmin(path);
  await run(path, async () => {
    const season = await getSeasonRow(sb);
    if (!season) throw new Error("No hay temporada activa");
    const up = Number(str(form, "up")), down = Number(str(form, "down"));
    if (!Number.isInteger(up) || !Number.isInteger(down) || up < 0 || down < 0) throw new Error("Los cupos deben ser números enteros, 0 o más.");
    const status = str(form, "status") === "CONFIRMED" ? "CONFIRMED" : "PLANNED";
    must(await sb.from("category_quotas").upsert({ season_id: season.id, category_id: cat, up, down, status, updated_at: new Date().toISOString() }, { onConflict: "season_id,category_id" }));
    await audit(sb, user.email, "QUOTA_SAVED", "category", cat, { up, down, status });
    return `Cupos guardados: ${up} suben y ${down} bajan (${status === "CONFIRMED" ? "confirmados" : "previstos"}).`;
  });
}

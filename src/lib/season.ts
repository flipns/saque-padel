import { supabaseServer, supabaseConfigured } from "./supabase/server";

export interface SeasonInfo {
  name: string;
  registrationDeadline: Date;
  startsAt: Date;
  mastersStart: string;
  mastersEnd: string;
  formUrl: string | null;
  feePerPlayer: number;
  prize: { amount: number; provider: string };
  categories: { division: "MASCULINA" | "FEMENINA"; code: string; name: string; level: number }[];
}

/** Valores oficiales por si la base de datos aún no está configurada. La fuente real es la tabla seasons. */
const FALLBACK: SeasonInfo = {
  name: "SAQUE LEAGUE 2026/27",
  registrationDeadline: new Date("2026-11-01T23:59:59+01:00"),
  startsAt: new Date("2026-11-06T00:00:00+01:00"),
  mastersStart: "2027-05-28",
  mastersEnd: "2027-05-30",
  formUrl: "https://forms.gle/aZ264rTFJippxzH88",
  feePerPlayer: 10,
  prize: { amount: 200, provider: "Playtomic" },
  categories: [
    { division: "MASCULINA", code: "PREMIER", name: "Premier", level: 1 },
    { division: "MASCULINA", code: "ORO", name: "Oro", level: 2 },
    { division: "MASCULINA", code: "PLATA", name: "Plata", level: 3 },
    { division: "MASCULINA", code: "BRONCE", name: "Bronce", level: 4 },
    { division: "MASCULINA", code: "ROOKIE", name: "Rookie", level: 5 },
    { division: "FEMENINA", code: "ORO", name: "Oro", level: 1 },
    { division: "FEMENINA", code: "PLATA", name: "Plata", level: 2 },
    { division: "FEMENINA", code: "BRONCE", name: "Bronce", level: 3 },
  ],
};

export async function getSeason(): Promise<SeasonInfo> {
  if (!supabaseConfigured()) return FALLBACK;
  try {
    const sb = await supabaseServer();
    const { data: s } = await sb.from("seasons").select("*").eq("is_current", true).maybeSingle();
    if (!s) return FALLBACK;
    const { data: cats } = await sb
      .from("categories")
      .select("code, name, level_order, active, divisions!inner(code, season_id)")
      .eq("divisions.season_id", s.id)
      .eq("active", true);
    return {
      name: s.name,
      registrationDeadline: new Date(s.registration_deadline_at),
      startsAt: new Date(s.season_starts_at),
      mastersStart: s.masters_starts_on,
      mastersEnd: s.masters_ends_on,
      formUrl: s.registration_form_url,
      feePerPlayer: Number(s.entry_fee_per_player),
      prize: { amount: Number(s.prize?.amount ?? 200), provider: s.prize?.provider ?? "Playtomic" },
      categories: (cats ?? [])
        .map((c: any) => ({ division: c.divisions.code, code: c.code, name: c.name, level: c.level_order }))
        .sort((a: any, b: any) => (a.division === b.division ? a.level - b.level : a.division === "MASCULINA" ? -1 : 1)),
    };
  } catch {
    return FALLBACK;
  }
}

const TZ = "Europe/Madrid";
export const fmtDay = (d: Date | string, opts: Intl.DateTimeFormatOptions = {}) =>
  new Date(d).toLocaleDateString("es-ES", { timeZone: TZ, day: "numeric", month: "long", ...opts });

import { addDays } from "@/lib/availability";
import { isoToMadridParts, madridToIso } from "@/lib/dates";

/** Un partido programado, listo para mostrarse o para compartir. */
export interface ShareMatch { startsAt: string; court: string | null; category: string; a: string; b: string }

const MATCH_MINUTES = 90;
const byStart = (x: ShareMatch, y: ShareMatch) => Date.parse(x.startsAt) - Date.parse(y.startsAt) || x.category.localeCompare(y.category, "es");

/** Un partido sigue siendo «próximo» hasta que acaba su turno de 90 minutos (así un partido que está jugándose aún sale). */
export const isUpcoming = (startsAt: string, now: Date) => Date.parse(startsAt) + MATCH_MINUTES * 60000 > now.getTime();

/**
 * Próximos partidos ordenados del más cercano al más lejano. `days`: solo los de hoy y los N-1 días siguientes
 * (hora de Madrid); null = todos los programados.
 */
export function filterUpcoming(list: ShareMatch[], now: Date, days: number | null): ShareMatch[] {
  const today = isoToMadridParts(now.toISOString()).date;
  const limit = days ? addDays(today, days) : null;   // exclusivo
  return list.filter((m) => isUpcoming(m.startsAt, now) && (!limit || isoToMadridParts(m.startsAt).date < limit)).sort(byStart);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Jueves 12 de noviembre» para una fecha «AAAA-MM-DD» (sin la coma que pone el formato por defecto). */
export function dayLabel(date: string): string {
  const parts = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" }).formatToParts(new Date(madridToIso(date, "12:00")));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return cap(`${get("weekday")} ${get("day")} de ${get("month")}`);
}

/** Agrupa partidos (ya ordenados) por día de Madrid. */
export function groupByDay<T extends { startsAt: string }>(list: T[]): { date: string; items: T[] }[] {
  const out: { date: string; items: T[] }[] = [];
  for (const m of list) {
    const date = isoToMadridParts(m.startsAt).date;
    const last = out[out.length - 1];
    if (last && last.date === date) last.items.push(m); else out.push({ date, items: [m] });
  }
  return out;
}

export const SHARE_TITLE = "SAQUE LEAGUE · Próximos partidos";
export const SHARE_FOOTER = "🍻 ¡Pásate por el club a ver jugar la liga y a tomar algo!";

/**
 * Texto para pegar en WhatsApp: fecha y hora, categoría, pista y las dos parejas. Usa *negritas* de WhatsApp
 * (si se pega en otro sitio solo se ven los asteriscos). Si no hay partidos, un mensaje corto que lo dice.
 */
export function buildShareText(list: ShareMatch[], opts: { title?: string; footer?: string; emptyText?: string } = {}): string {
  const title = opts.title ?? SHARE_TITLE;
  const footer = opts.footer ?? SHARE_FOOTER;
  if (list.length === 0) return `*${title}* 🎾\n\n${opts.emptyText ?? "Por ahora no hay partidos programados."}\n\n${footer}`;
  const blocks = groupByDay(list).map(({ date, items }) => {
    const lines = items.map((m) => {
      const court = m.court?.trim() ? ` · ${cap(m.court.trim())}` : "";
      return `⏰ ${isoToMadridParts(m.startsAt).time}${court} · ${m.category}\n${m.a}\nvs\n${m.b}`;
    });
    return `*${dayLabel(date)}*\n\n${lines.join("\n\n")}`;
  });
  return `*${title}* 🎾\n\n${blocks.join("\n\n")}\n\n${footer}`;
}

/** Enlace que abre WhatsApp con el texto ya escrito. */
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

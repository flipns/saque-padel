const TZ = "Europe/Madrid";

/** Hora de pared en Madrid («2026-11-06», «18:30») -> instante ISO correcto (con horario de verano). */
export function madridToIso(date: string, time = "00:00:00"): string {
  const t = time.length === 5 ? `${time}:00` : time;
  const naive = new Date(`${date}T${t}Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(naive).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = asUtc - naive.getTime();
  return new Date(naive.getTime() - offsetMs).toISOString();
}

/** ISO -> {date: «2026-11-06», time: «18:30»} en hora de Madrid, para rellenar inputs. */
export function isoToMadridParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const fmtDate = (iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) =>
  iso ? new Date(iso).toLocaleDateString("es-ES", { timeZone: TZ, ...opts }) : "";

export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("es-ES", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

/** Tiempo que falta hasta una fecha, en lenguaje llano («1 d 4 h», «35 min»). */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "ya vencido";
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${min % 60} min`;
  return `${min} min`;
}

/** «sáb, 14 nov · 11:30–13:00» (hora de Madrid). */
export function fmtRange(iso: string, minutes = 90): string {
  const d = new Date(iso), e = new Date(d.getTime() + minutes * 60000);
  const day = d.toLocaleDateString("es-ES", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  const hm = (x: Date) => x.toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${hm(d)}–${hm(e)}`;
}

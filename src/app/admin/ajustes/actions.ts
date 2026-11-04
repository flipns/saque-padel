"use server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, must } from "@/lib/flash";
import { str } from "@/lib/form";
import { madridToIso } from "@/lib/dates";
import { getSeasonRow } from "@/lib/data";

const PATH = "/admin/ajustes";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function saveDatesAction(form: FormData) {
  const { sb, user } = await requireAdmin(PATH);
  await run(PATH, async () => {
    const season = await getSeasonRow(sb);
    if (!season) throw new Error("No hay temporada activa");
    const deadline = str(form, "deadline"), start = str(form, "start");
    if (!deadline || !start) throw new Error("Indica las dos fechas.");
    must(await sb.from("seasons").update({
      registration_deadline_at: madridToIso(deadline, "23:59:59"), season_starts_at: madridToIso(start, "00:00:00"),
      registration_form_url: str(form, "formUrl") || null,
    }).eq("id", season.id));
    await audit(sb, user.email, "SEASON_DATES_SAVED", "season", season.id, { deadline, start });
    return "Fechas guardadas.";
  });
}

export async function saveContactAction(form: FormData) {
  const { sb, user } = await requireAdmin(PATH);
  await run(PATH, async () => {
    const season = await getSeasonRow(sb);
    if (!season) throw new Error("No hay temporada activa");
    const share = form.get("share") === "on";
    must(await sb.from("seasons").update({ share_rival_contact: share }).eq("id", season.id));
    await audit(sb, user.email, "SHARE_CONTACT_SET", "season", season.id, { share });
    return share ? "Los jugadores verán el móvil de sus rivales adultos." : "Los móviles de los rivales quedan ocultos.";
  });
}

export async function savePrizeAction(form: FormData) {
  const { sb, user } = await requireAdmin(PATH);
  await run(PATH, async () => {
    const season = await getSeasonRow(sb);
    if (!season) throw new Error("No hay temporada activa");
    const amount = Number(str(form, "amount"));
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Importe no válido.");
    const scope = str(form, "scope");
    const prize = { ...(season.prize ?? {}), amount, currency: "EUR", type: "BONO_MONEDERO", provider: "Playtomic",
      award_scope: scope === "PAIR" || scope === "PLAYER" ? scope : null, status: scope === "PAIR" || scope === "PLAYER" ? "CONFIRMED" : "PENDING_CONFIRMATION" };
    must(await sb.from("seasons").update({ prize }).eq("id", season.id));
    await audit(sb, user.email, "PRIZE_SAVED", "season", season.id, prize);
    return "Premio guardado.";
  });
}

export async function addAdminAction(form: FormData) {
  const { sb, user } = await requireAdmin(PATH);
  await run(PATH, async () => {
    const email = str(form, "email").toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Escribe un email válido.");
    must(await sb.from("admins").upsert({ email }, { onConflict: "email", ignoreDuplicates: true }));
    await audit(sb, user.email, "ADMIN_ADDED", "admin", email);
    return `${email} ya es administrador. Entra con el enlace por email.`;
  });
}

export async function removeAdminAction(form: FormData) {
  const { sb, user } = await requireAdmin(PATH);
  await run(PATH, async () => {
    const email = str(form, "email").toLowerCase();
    if (email === (user.email ?? "").toLowerCase()) throw new Error("No puedes quitarte a ti mismo.");
    const left = must(await sb.from("admins").select("email")) as any[];
    if (left.length <= 1) throw new Error("Debe quedar al menos un administrador.");
    must(await sb.from("admins").delete().eq("email", email));
    await audit(sb, user.email, "ADMIN_REMOVED", "admin", email);
    return `${email} ya no es administrador.`;
  });
}

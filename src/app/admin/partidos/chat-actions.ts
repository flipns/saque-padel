"use server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, must } from "@/lib/flash";
import { notifyPairs } from "@/lib/notify";
import { str } from "@/lib/form";

async function auth(matchId: string) {
  const path = `/admin/partidos/${matchId}`;
  const { sb, user } = await requireAdmin(path);
  return { path, sb, user };
}

/** Elimina un mensaje (moderación). Los jugadores ven «Mensaje eliminado por la organización»; el original solo lo conserva la organización. */
export async function deleteMessageAction(form: FormData) {
  const match = str(form, "match");
  const { path, sb, user } = await auth(match);
  await run(path, async () => {
    const reason = str(form, "reason");
    if (!reason) throw new Error("Escribe el motivo de la eliminación.");
    must(await sb.from("match_messages").update({ deleted_at: new Date().toISOString(), deleted_by: user.email, delete_reason: reason }).eq("id", str(form, "message")).eq("match_id", match));
    await audit(sb, user.email, "CHAT_MESSAGE_DELETED", "chat", str(form, "message"), { match }, reason);
    return "Mensaje eliminado. Los jugadores ven que la organización lo ha retirado.";
  });
}

export async function restoreMessageAction(form: FormData) {
  const match = str(form, "match");
  const { path, sb, user } = await auth(match);
  await run(path, async () => {
    must(await sb.from("match_messages").update({ deleted_at: null, deleted_by: null, delete_reason: null }).eq("id", str(form, "message")).eq("match_id", match));
    await audit(sb, user.email, "CHAT_MESSAGE_RESTORED", "chat", str(form, "message"), { match });
    return "Mensaje restaurado.";
  });
}

/** Mensaje de la organización en el chat del partido; además se avisa a los cuatro jugadores (también por email). */
export async function orgMessageAction(form: FormData) {
  const match = str(form, "match");
  const { path, sb, user } = await auth(match);
  await run(path, async () => {
    const body = str(form, "body");
    if (!body) throw new Error("Escribe el mensaje.");
    if (body.length > 1000) throw new Error("El mensaje es demasiado largo (máximo 1000 caracteres).");
    const m = must(await sb.from("matches").select("pair_a_id, pair_b_id").eq("id", match).single()) as any;
    must(await sb.from("match_messages").insert({ match_id: match, kind: "ORG", author_name: "Organización", author_email: user.email, body }));
    await notifyPairs(sb, [m.pair_a_id, m.pair_b_id], { matchId: match, kind: "CHAT_ORG", title: "Mensaje de la organización sobre vuestro partido", body: body.length > 400 ? `${body.slice(0, 400)}…` : body });
    await audit(sb, user.email, "CHAT_ORG_MESSAGE", "chat", match, { length: body.length });
    return "Mensaje enviado al chat. Se avisa a los cuatro jugadores.";
  });
}

"use server";
import { after } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { flushEmails } from "@/lib/email";
import { loadChat, type ChatMessage } from "@/lib/chat";

/** Envía un mensaje al chat del partido. La base de datos comprueba que seas uno de los cuatro jugadores. */
export async function sendChatAction(matchId: string, body: string): Promise<{ ok: boolean; error?: string; messages?: ChatMessage[] }> {
  const sb = await supabaseServer();
  const { error } = await sb.rpc("send_chat_message", { p_match: matchId, p_body: body });
  if (error) return { ok: false, error: error.message };
  after(async () => { try { await flushEmails({ limit: 20 }); } catch (e) { console.error("flushEmails failed", e); } });
  try { return { ok: true, messages: await loadChat(sb, matchId) }; } catch { return { ok: true }; }
}

/** Marca el chat como leído (y quita el contador de mensajes nuevos). */
export async function markChatReadAction(matchId: string): Promise<void> {
  const sb = await supabaseServer();
  await sb.rpc("mark_chat_read", { p_match: matchId });
}

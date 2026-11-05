import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChatMessage {
  id: string;
  kind: "USER" | "SYSTEM" | "ORG";
  author_name: string | null;
  author_pair: string | null;
  is_mine: boolean;
  body: string | null;   // null si la organización lo ha eliminado
  deleted: boolean;
  created_at: string;
}

/** Estados en los que el partido está cerrado y el chat queda solo de lectura. */
export const CHAT_CLOSED = ["COMPLETED", "WO", "NOT_PLAYED", "CANCELLED"];

export async function loadChat(sb: SupabaseClient, matchId: string, limit = 200): Promise<ChatMessage[]> {
  const { data, error } = await sb.rpc("chat_messages", { p_match: matchId, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChatMessage[];
}

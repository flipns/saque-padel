import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Mensajes del chat de un partido, para refrescarlo sin recargar la página.
 * La autorización la decide la base de datos (solo los cuatro jugadores del partido); aquí solo se exige sesión.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ match: string }> }) {
  const { match } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match)) return NextResponse.json({ error: "Partido no válido" }, { status: 400 });
  const sb = await supabaseServer();
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return NextResponse.json({ error: "Sesión caducada" }, { status: 401 });
  const { data, error } = await sb.rpc("chat_messages", { p_match: match, p_limit: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: /no es tuyo/i.test(error.message) ? 403 : 500 });
  return NextResponse.json({ messages: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

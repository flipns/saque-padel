import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { destinationAfterLogin } from "@/lib/afterLogin";

/** Enlace con ?code= (flujo PKCE). Solo funciona en el mismo navegador que pidió el enlace. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(await destinationAfterLogin(sb, url.searchParams.get("next")), url.origin));
    console.error("exchangeCodeForSession failed", error);
  }
  return NextResponse.redirect(new URL("/acceso?error=enlace", url.origin));
}

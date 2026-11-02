import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { destinationAfterLogin } from "@/lib/afterLogin";

/**
 * Enlace del email (plantilla con token_hash). Funciona aunque el email se abra
 * en otro navegador o dispositivo distinto del que pidió el enlace.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
  if (token_hash) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.verifyOtp({ token_hash, type });
    if (!error) return NextResponse.redirect(new URL(await destinationAfterLogin(sb, url.searchParams.get("next")), url.origin));
    console.error("verifyOtp failed", error);
  }
  return NextResponse.redirect(new URL("/acceso?error=enlace", url.origin));
}

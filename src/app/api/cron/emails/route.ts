import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { flushEmails } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest, secret: string) {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Tarea diaria (Vercel Cron): crea los recordatorios (48 h sin respuesta, cierre de fase a 7 días y 48 h),
 * confirma resultados vencidos y envía por email todos los avisos pendientes (incluidos reintentos).
 * Solo responde si la petición lleva `Authorization: Bearer <CRON_SECRET>`; sin CRON_SECRET configurado no hace nada.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no está configurado" }, { status: 500 });
  if (!authorized(req, secret)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const db = supabaseAdmin();
  const [rem, auto] = await Promise.all([db.rpc("generate_reminders"), db.rpc("auto_confirm_due")]);
  if (rem.error) console.error("generate_reminders failed", rem.error.message);
  if (auto.error) console.error("auto_confirm_due failed", auto.error.message);
  const emails = await flushEmails({ limit: 400 });
  return NextResponse.json({ reminders: rem.data ?? 0, autoConfirmed: auto.data ?? 0, emails });
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { renderNotificationEmail } from "@/lib/emailTemplate";

export interface FlushResult { sent: number; skipped: number; failed: number; configured: boolean }
type Row = { id: string; email: string; match_id: string | null; kind: string; title: string; body: string | null };

/**
 * Envía por email los avisos pendientes. Reserva las filas de forma atómica (varias ejecuciones a la vez
 * nunca envían el mismo aviso dos veces) y reintenta hasta 3 veces los que fallen. Sin SMTP configurado no hace nada.
 */
export async function flushEmails(opts: { limit?: number } = {}): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, skipped: 0, failed: 0, configured: mailConfigured() };
  if (!result.configured) return result;
  const db = supabaseAdmin();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  let remaining = Math.max(1, Math.min(opts.limit ?? 50, 500));

  while (remaining > 0) {
    const take = Math.min(50, remaining);
    const { data, error } = await db.rpc("claim_pending_emails", { p_limit: take });
    if (error) { console.error("claim_pending_emails failed", error.message); break; }
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    remaining -= rows.length;

    const { data: prefs } = await db.from("notification_prefs").select("email, email_enabled").in("email", [...new Set(rows.map((r) => r.email))]);
    const off = new Set(((prefs ?? []) as any[]).filter((p) => !p.email_enabled).map((p) => p.email as string));

    for (let i = 0; i < rows.length; i += 5) {
      await Promise.all(rows.slice(i, i + 5).map(async (r) => {
        const now = new Date().toISOString();
        if (off.has(r.email)) {
          await db.from("notifications").update({ emailed_at: now, email_status: "SKIPPED_OPTOUT" }).eq("id", r.id);
          result.skipped++;
          return;
        }
        try {
          const { subject, html, text } = renderNotificationEmail(r, site);
          await sendMail({ to: r.email, subject, html, text });
          await db.from("notifications").update({ emailed_at: now, email_status: "SENT", email_error: null }).eq("id", r.id);
          result.sent++;
        } catch (e: any) {
          console.error("email failed:", r.email, e?.message);
          await db.from("notifications").update({ email_error: String(e?.message ?? e).slice(0, 300) }).eq("id", r.id);
          result.failed++;
        }
      }));
    }
    if (rows.length < take) break;
  }
  return result;
}

/** Plantilla de los emails de aviso (HTML con estilos en línea, válido en Gmail, Outlook y móviles) y su versión en texto. */

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface EmailNotification { title: string; body: string | null; match_id: string | null; kind: string }

export function renderNotificationEmail(n: EmailNotification, siteUrl: string): { subject: string; html: string; text: string } {
  const base = siteUrl.replace(/\/$/, "");
  const url = n.match_id ? `${base}/mi-liga/partido/${n.match_id}` : `${base}/mi-liga/avisos`;
  const cta = n.match_id ? "Ver el partido" : "Ver mis avisos";
  const body = n.body ?? "";
  const subject = `SAQUE LEAGUE · ${n.title}`;
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#eef2fa;font-family:Arial,Helvetica,sans-serif;color:#071e47">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#071e47;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:.5px">SAQUE LEAGUE <span style="font-weight:300">2026/27</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.25;color:#071e47">${escapeHtml(n.title)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#071e47">${escapeHtml(body)}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;background:#071e47;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:12px 26px;border-radius:999px">${cta}</a>
</td></tr>
<tr><td style="padding:16px 28px;background:#f6f8fc;color:#4a5875;font-size:12px;line-height:1.5">
Recibes este email porque participas en la SAQUE LEAGUE de la Escuela de Pádel Saque. Si el jugador es menor, el email llega al tutor.<br>
Puedes dejar de recibir estos emails desde <a href="${escapeHtml(base)}/mi-liga/avisos" style="color:#3d5aa8">Avisos</a> en la web; los avisos seguirán apareciendo allí.
</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${n.title}\n\n${body}\n\n${cta}: ${url}\n\n—\nSAQUE LEAGUE 2026/27. Puedes dejar de recibir estos emails desde ${base}/mi-liga/avisos`;
  return { subject, html, text };
}

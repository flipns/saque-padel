import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/** Hay envío de emails configurado (Gmail del club con contraseña de aplicación, o un servidor SMTP propio). */
export const mailConfigured = () => Boolean(process.env.SMTP_HOST || (process.env.SMTP_USER && process.env.SMTP_PASS));

export const fromAddress = () => process.env.MAIL_FROM ?? `SAQUE LEAGUE <${process.env.SMTP_USER ?? "no-reply@localhost"}>`;

let transport: Transporter | null = null;
function getTransport(): Transporter {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT ?? 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    pool: true,
    maxConnections: 3,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

export async function sendMail(m: { to: string; subject: string; html: string; text: string }) {
  await getTransport().sendMail({ from: fromAddress(), ...m });
}

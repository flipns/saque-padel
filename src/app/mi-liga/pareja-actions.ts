"use server";
import { requirePlayer } from "@/lib/auth";
import { run, must } from "@/lib/flash";
import { str } from "@/lib/form";

/** «¿Quién eres?»: vincula el email de la sesión con uno de los dos jugadores de la pareja. */
export async function claimIdentityAction(form: FormData) {
  const pair = str(form, "pair");
  const path = `/mi-liga?p=${pair}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    must(await sb.rpc("claim_identity", { p_pair: pair, p_player: str(form, "player") }));
    return "Listo, ya sabemos quién eres.";
  });
}

/** Añade el email del compañero/a para que pueda entrar con su propio enlace y crear su contraseña. */
export async function addPartnerAction(form: FormData) {
  const pair = str(form, "pair");
  const path = `/mi-liga?p=${pair}`;
  const { sb } = await requirePlayer(path);
  await run(path, async () => {
    must(await sb.rpc("add_partner_email", { p_pair: pair, p_email: str(form, "email") }));
    return "Email añadido. Tu compañero/a ya puede entrar desde la pantalla de acceso.";
  });
}

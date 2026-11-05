"use server";
import { revalidatePath } from "next/cache";
import { requirePlayer } from "@/lib/auth";
import { run, must } from "@/lib/flash";
import { str } from "@/lib/form";

/** Marca como leídos todos los avisos de la persona que entra y refresca el contador de la navegación. */
export async function markReadAction() {
  const { sb } = await requirePlayer("/mi-liga/avisos");
  await sb.rpc("mark_notifications_read");
  revalidatePath("/mi-liga", "layout");
}

/** Activa o desactiva los emails de aviso de esta persona (los avisos dentro de la web siguen apareciendo). */
export async function setEmailPrefAction(form: FormData) {
  const { sb } = await requirePlayer("/mi-liga/avisos");
  await run("/mi-liga/avisos", async () => {
    const enabled = str(form, "enabled") === "1";
    must(await sb.rpc("set_email_pref", { p_enabled: enabled }));
    return enabled ? "Volverás a recibir los avisos por email." : "No recibirás más emails de aviso. Seguirás viéndolos aquí.";
  });
}

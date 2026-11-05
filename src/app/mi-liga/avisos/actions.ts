"use server";
import { revalidatePath } from "next/cache";
import { requirePlayer } from "@/lib/auth";

/** Marca como leídos todos los avisos de la persona que entra y refresca el contador de la navegación. */
export async function markReadAction() {
  const { sb } = await requirePlayer("/mi-liga/avisos");
  await sb.rpc("mark_notifications_read");
  revalidatePath("/mi-liga", "layout");
}

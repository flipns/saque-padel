"use client";
import { useEffect } from "react";
import { markReadAction } from "./actions";

/** Al abrir la pantalla de avisos, los marca como leídos (el contador se actualiza al terminar). */
export function MarkRead({ unread }: { unread: number }) {
  useEffect(() => { if (unread > 0) void markReadAction(); }, [unread]);
  return null;
}

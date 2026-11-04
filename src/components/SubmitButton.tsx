"use client";
import { useFormStatus } from "react-dom";

/** Botón de envío que se desactiva mientras la acción está en curso (evita dobles envíos). */
export function SubmitButton({ children, className = "btn btn-navy", pendingText = "Guardando…", confirm }: {
  children: React.ReactNode; className?: string; pendingText?: string; confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {pending ? pendingText : children}
    </button>
  );
}

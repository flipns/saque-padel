/**
 * Lee las «claims» de un token de acceso SIN verificarlas. Sirve solo para ADELANTAR consultas que dependen del email
 * mientras se verifica la sesión contra Auth (getUser). Nunca para decidir permisos: los datos están protegidos por
 * RLS, que valida la firma del token en cada consulta, y el usuario que se devuelve a las pantallas sigue siendo el verificado.
 */
export function claimsFromToken(token?: string | null): { email?: string; sub?: string } | null {
  try {
    const part = token?.split(".")[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

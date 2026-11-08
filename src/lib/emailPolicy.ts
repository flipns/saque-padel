/**
 * Qué avisos se envían además por EMAIL. Todos los avisos aparecen siempre en la web (pestaña Avisos); por email
 * solo salen estos tres tipos:
 *   - DATES_PROPOSED   → te han propuesto fechas (también cuando contraproponen otras)
 *   - DATE_AGREED      → han aceptado una fecha
 *   - RESULT_SUBMITTED → han introducido el resultado de un partido (también cuando lo corrigen)
 * Debe coincidir con la función email_kinds() de la migración 0012; hay un test que lo comprueba.
 */
export const EMAIL_KINDS = ["DATES_PROPOSED", "DATE_AGREED", "RESULT_SUBMITTED"] as const;

export const isEmailKind = (kind: string): boolean => (EMAIL_KINDS as readonly string[]).includes(kind);

/** Texto para explicar a las personas qué emails reciben. */
export const EMAIL_SCOPE_TEXT = "cuando te proponen fechas, aceptan una fecha o introducen un resultado";

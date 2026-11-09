/**
 * Memoria por conexión: guarda el resultado de una consulta mientras exista la conexión (`sb`) de esa petición.
 * React.cache solo evita repeticiones al pintar pantallas; dentro de las acciones (los botones que guardan) no
 * funciona, y cada comprobación se hacía dos veces. Cada petición tiene su propia conexión, así que nunca se
 * comparten datos entre personas, y la memoria desaparece con la conexión.
 */
const perClient = new WeakMap<object, Map<string, Promise<unknown>>>();

export function memoFor<T>(client: object, key: string, fn: () => Promise<T>): Promise<T> {
  let m = perClient.get(client);
  if (!m) { m = new Map(); perClient.set(client, m); }
  let p = m.get(key) as Promise<T> | undefined;
  if (!p) { p = fn(); m.set(key, p); }
  return p;
}

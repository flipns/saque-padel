import { SubmitButton } from "@/components/SubmitButton";
import { claimIdentityAction, addPartnerAction } from "./pareja-actions";

type Row = { player_id: string; full_name: string; is_me: boolean; has_access: boolean };

/** Tarjeta para completar la pareja: quién eres y el email del compañero. Desaparece cuando todo está hecho. */
export function PairSetup({ pairId, rows, siteUrl }: { pairId: string; rows: Row[]; siteUrl: string }) {
  const me = rows.find((r) => r.is_me);
  const partner = rows.find((r) => !r.is_me);
  if (me && partner?.has_access) return null;

  if (!me) {
    return (
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>¿Quién eres?</h2>
        <p className="muted" style={{ margin: ".3rem 0 .9rem" }}>Así sabremos quién eres tú y quién tu compañero/a en los partidos.</p>
        <div className="actions">
          {rows.map((r) => (
            <form key={r.player_id} action={claimIdentityAction}>
              <input type="hidden" name="pair" value={pairId} /><input type="hidden" name="player" value={r.player_id} />
              <SubmitButton className="btn btn-outline" confirm={`¿Confirmas que eres ${r.full_name}? Solo se puede cambiar avisando a la organización.`}>Soy {r.full_name}</SubmitButton>
            </form>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: "1.25rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Añade a tu compañero/a</h2>
      <p className="muted" style={{ margin: ".3rem 0 .9rem" }}>
        <b>{partner?.full_name}</b> todavía no tiene acceso propio. Escribe su email: entrará desde <b>{siteUrl.replace(/^https?:\/\//, "")}/acceso</b>, recibirá un enlace y creará su contraseña. Si es menor, usa el email de su tutor.
      </p>
      <form action={addPartnerAction} style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <input type="hidden" name="pair" value={pairId} />
        <div style={{ flex: "1 1 240px" }}><label htmlFor="partner-email" className="sr-only">Email de tu compañero/a</label>
          <input id="partner-email" name="email" type="email" required placeholder="email@ejemplo.com" /></div>
        <SubmitButton className="btn btn-navy">Añadir</SubmitButton>
      </form>
    </div>
  );
}

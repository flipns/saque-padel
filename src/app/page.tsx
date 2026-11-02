import Image from "next/image";
import Link from "next/link";
import { getSeason, fmtDay } from "@/lib/season";
import s from "./landing.module.css";

export const revalidate = 60;

const DOT: Record<string, string> = {
  PREMIER: "var(--navy)", ORO: "var(--gold)", PLATA: "var(--silver)", BRONCE: "var(--bronze)", ROOKIE: "var(--rookie)",
};

export default async function Home() {
  const season = await getSeason();
  const open = Date.now() <= season.registrationDeadline.getTime();
  const men = season.categories.filter((c) => c.division === "MASCULINA");
  const women = season.categories.filter((c) => c.division === "FEMENINA");
  const mastersDays = `${new Date(season.mastersStart).getUTCDate()}, ${new Date(season.mastersStart).getUTCDate() + 1} y ${fmtDay(season.mastersEnd)}`;

  return (
    <main>
      <section className={s.hero}>
        <Image src="/brand/q-white.png" alt="" width={600} height={637} className={s.heroQ} priority aria-hidden />
        <div className={`wrap ${s.heroInner}`}>
          <header className={s.topbar}>
            <Image src="/brand/saque-white.png" alt="Saque pádel social club" width={150} height={60} priority />
            <Link href="/acceso" className="btn btn-ghost">Entrar</Link>
          </header>

          <div className={s.heroCopy}>
            <p className={s.kicker}>Nueva temporada</p>
            <h1 className={`title ${s.heroTitle}`}>Saque<br />League</h1>
            <p className={s.season}>2026 / 2027</p>
            <p className={s.lead}>La liga interna de la Escuela de Pádel Saque.</p>
            <div className={s.ctaRow}>
              {open && season.formUrl ? (
                <a className="btn btn-light" href={season.formUrl} target="_blank" rel="noopener">Inscribir mi pareja</a>
              ) : (
                <Link className="btn btn-light" href="/acceso">Entrar como jugador</Link>
              )}
              <span className={s.ctaNote}>
                {open
                  ? `Plazo hasta el ${fmtDay(season.registrationDeadline)}`
                  : "Inscripciones cerradas. Si te has inscrito, entra con tu email."}
              </span>
            </div>
          </div>
        </div>

        <div className={s.dateBar}>
          <div className={s.dateItem}>
            <span>Fin de inscripciones</span>
            <strong>{fmtDay(season.registrationDeadline)}</strong>
          </div>
          <div className={s.dateItem}>
            <span>Comienzo de la liga</span>
            <strong>{fmtDay(season.startsAt, { weekday: "long" })}</strong>
          </div>
        </div>
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="temporada">
        <h2 id="temporada" className={`title ${s.h2}`}>Así es la temporada</h2>
        <ol className={s.track}>
          <li>
            <span className={s.when}>Noviembre a enero</span>
            <h3 className="title">Fase de nivelación</h3>
            <p>2 o 3 partidos al mes contra rivales distintos. Una clasificación por categoría suma los puntos de los tres meses y, al cerrar enero, decide ascensos y descensos.</p>
          </li>
          <li>
            <span className={s.when}>Febrero a mayo</span>
            <h3 className="title">Race to Masters</h3>
            <p>Grupos por nivel (A, B, C…). Cada mes el primero sube y el último baja. Tu puesto suma puntos para la Race de tu categoría.</p>
          </li>
          <li>
            <span className={s.when}>{mastersDays}</span>
            <h3 className="title">Saque Masters</h3>
            <p>Las 8 mejores parejas de cada categoría juegan cuartos, semifinales y final.</p>
          </li>
        </ol>
      </section>

      <section className={s.prize}>
        <div className={`wrap ${s.prizeInner}`}>
          <p className={`title ${s.prizeAmount}`}>{season.prize.amount} €</p>
          <p className={s.prizeText}>en bono monedero {season.prize.provider} para los ganadores del Saque Masters</p>
        </div>
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="categorias">
        <h2 id="categorias" className={`title ${s.h2}`}>Ocho categorías</h2>
        <div className={s.divisions}>
          {[["Masculinas", men], ["Femeninas", women]].map(([label, cats]) => (
            <div key={label as string}>
              <h3 className={s.divTitle}>{label as string}</h3>
              <ul className={s.cats}>
                {(cats as typeof men).map((c) => (
                  <li key={c.code}><i style={{ background: DOT[c.code] }} />{c.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="muted">Cada categoría tiene su propia clasificación, sus grupos y su cuadro del Masters. Masculinas y femeninas no se mezclan.</p>
      </section>

      <section className={`wrap ${s.block} ${s.facts}`} aria-label="Información práctica">
        <div><strong>2 o 3 partidos al mes</strong><p>Por pareja, en grupos de tres o cuatro.</p></div>
        <div><strong>90 minutos</strong><p>Reserva por partido. Si se acaba el tiempo, gana quien vaya por delante.</p></div>
        <div><strong>{season.feePerPlayer} € por jugador</strong><p>Cada partido se paga al precio habitual de la pista.</p></div>
        <div><strong>Ranking individual</strong><p>Sigue tu evolución toda la temporada, cambies o no de pareja.</p></div>
      </section>

      <footer className={s.footer}>
        <div className="wrap">
          <Image src="/brand/saque-navy.png" alt="Saque pádel social club" width={130} height={52} />
          <Link href="/acceso">Acceso jugadores</Link>
        </div>
      </footer>
    </main>
  );
}

import { Importer } from "./Importer";
import s from "../admin.module.css";

export default function ImportPage() {
  return (
    <>
      <h1>Importar inscripciones</h1>
      <p className="muted">
        Sube el CSV de la hoja de respuestas del Google Form. Podrás revisar cada fila antes de crear las parejas.
        Puedes repetir la importación: las parejas ya creadas se omiten.
      </p>
      <div className={s.panel}><Importer /></div>
    </>
  );
}

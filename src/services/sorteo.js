'use strict';

/**
 * Sorteo de premios · COTUCO
 *
 * La extracción se hace en la base, no en JavaScript, y dentro de una
 * transacción. Traer la lista de elegibles al servidor para elegir uno
 * abre una ventana entre «quiénes había» y «a quién se grabó»: si en
 * ese instante alguien entra por la puerta o se toca «Sortear» dos
 * veces, el resultado deja de ser defendible. Aquí la fila se bloquea y
 * se inserta en la misma operación.
 *
 * Nada de este módulo escribe en `asistentes` ni en `accesos`.
 */

const ESTADOS = ['ganador', 'descartado'];

/**
 * Quiénes pueden salir sorteados.
 *
 * Tres condiciones: no estar cancelado, no haber ganado ya, y —si el
 * organizador lo pidió— haber pasado por la puerta. La tercera es la
 * que decide si el sorteo premia asistencia o sólo registro, y por eso
 * llega como parámetro y no como una regla escondida.
 */
function condicionElegible(requiereEntrada) {
  return `
    a.cancelado_en IS NULL AND a.tipo = 'general'
    ${requiereEntrada ? 'AND a.llego_en IS NOT NULL' : ''}
    AND NOT EXISTS (
      SELECT 1 FROM sorteos s
       WHERE s.asistente_id = a.id AND s.estado = 'ganador'
    )`;
}

async function contarElegibles(db, requiereEntrada) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM asistentes a
      WHERE ${condicionElegible(requiereEntrada)}`
  );
  return rows[0].n;
}

/* ------------------------------------------------------------------ *
 * Premios
 * ------------------------------------------------------------------ */

function limpiarTexto(v, max) {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
}

async function listarPremios(db) {
  const { rows } = await db.query(
    `SELECT p.id, p.nombre, p.patrocinador, p.orden,
            g.sorteo_id, g.asistente_id,
            g.nombre AS ganador, g.organismo AS ganador_organismo,
            g.creado_en AS sorteado_en,
            (SELECT count(*)::int FROM sorteos d
              WHERE d.premio_id = p.id AND d.estado = 'descartado') AS descartes
       FROM premios p
       LEFT JOIN LATERAL (
         SELECT s.id AS sorteo_id, s.asistente_id, s.creado_en,
                a.nombre, a.organismo
           FROM sorteos s
           JOIN asistentes a ON a.id = s.asistente_id
          WHERE s.premio_id = p.id AND s.estado = 'ganador'
          LIMIT 1
       ) g ON true
      ORDER BY p.orden, p.id`
  );
  return rows;
}

async function crearPremio(db, { nombre, patrocinador, orden }) {
  const n = limpiarTexto(nombre, 90);
  if (!n) return { ok: false, error: 'El premio necesita un nombre' };
  const o = Number.isFinite(parseInt(orden, 10)) ? parseInt(orden, 10) : 0;

  const { rows } = await db.query(
    `INSERT INTO premios (nombre, patrocinador, orden)
     VALUES ($1,$2,$3)
     RETURNING id, nombre, patrocinador, orden`,
    [n, limpiarTexto(patrocinador, 90), o]
  );
  return { ok: true, premio: rows[0] };
}

/**
 * Borrar un premio se lleva sus sorteos por delante (ON DELETE CASCADE),
 * así que se bloquea si ya tiene ganador vigente: borrar el acta de algo
 * que ya se anunció en el salón no es una operación, es un accidente.
 */
async function borrarPremio(db, id) {
  const { rows: g } = await db.query(
    `SELECT 1 FROM sorteos WHERE premio_id = $1 AND estado = 'ganador'`,
    [id]
  );
  if (g[0]) {
    return { ok: false, error: 'Ese premio ya tiene ganador. Descarta el ganador antes de borrarlo.' };
  }
  const { rows } = await db.query(
    'DELETE FROM premios WHERE id = $1 RETURNING id, nombre',
    [id]
  );
  return rows[0] ? { ok: true, premio: rows[0] } : { ok: false, error: 'No encontrado' };
}

/* ------------------------------------------------------------------ *
 * La extracción
 * ------------------------------------------------------------------ */

/**
 * Saca un ganador para un premio.
 *
 * `client` tiene que venir dentro de una transacción. El índice único
 * parcial de la base rechaza un segundo ganador vigente para el mismo
 * premio, así que dos clics simultáneos no producen dos ganadores: el
 * segundo falla y se reporta como tal en vez de sobrescribir al primero.
 */
async function sortear(client, premioId, requiereEntrada, usuario) {
  const { rows: p } = await client.query(
    'SELECT id, nombre, patrocinador FROM premios WHERE id = $1 FOR UPDATE',
    [premioId]
  );
  if (!p[0]) return { ok: false, error: 'Ese premio no existe' };

  const { rows: ya } = await client.query(
    `SELECT 1 FROM sorteos WHERE premio_id = $1 AND estado = 'ganador'`,
    [premioId]
  );
  if (ya[0]) {
    return { ok: false, error: 'Ese premio ya tiene ganador. Descártalo para volver a sortear.' };
  }

  // ORDER BY random() sobre el padrón de un cóctel —cientos de filas, no
  // millones— es correcto y legible. Optimizarlo aquí sería cambiar
  // claridad por un tiempo que nadie va a notar.
  const { rows: elegido } = await client.query(
    `SELECT a.id, a.nombre, a.organismo
       FROM asistentes a
      WHERE ${condicionElegible(requiereEntrada)}
      ORDER BY random()
      LIMIT 1`
  );
  if (!elegido[0]) {
    return {
      ok: false,
      error: requiereEntrada
        ? 'No hay nadie elegible: o no ha entrado nadie todavía, o ya ganaron todos los presentes.'
        : 'No hay nadie elegible en el padrón.',
    };
  }

  try {
    const { rows } = await client.query(
      `INSERT INTO sorteos (premio_id, asistente_id, por)
       VALUES ($1,$2,$3) RETURNING id, creado_en`,
      [premioId, elegido[0].id, usuario || null]
    );
    return {
      ok: true,
      sorteo: { id: rows[0].id, creado_en: rows[0].creado_en },
      premio: p[0],
      ganador: elegido[0],
    };
  } catch (err) {
    // 23505 = chocó con uno de los dos índices únicos parciales.
    if (err.code === '23505') {
      return { ok: false, error: 'Alguien más sorteó este premio al mismo tiempo. Vuelve a cargar.' };
    }
    throw err;
  }
}

/**
 * Descarta un ganador para poder volver a sortear.
 *
 * Es lo que se usa cuando sale alguien que ya se fue del salón. No se
 * borra la fila: queda como 'descartado' y el premio vuelve a quedar
 * libre, con el rastro de lo que pasó.
 */
async function descartar(client, sorteoId, usuario) {
  const { rows } = await client.query(
    `UPDATE sorteos SET estado = 'descartado'
      WHERE id = $1 AND estado = 'ganador'
      RETURNING id, premio_id, asistente_id`,
    [sorteoId]
  );
  if (!rows[0]) return { ok: false, error: 'Ese sorteo no existe o ya estaba descartado' };
  return { ok: true, sorteo: rows[0], por: usuario || null };
}

/**
 * Lo que mira la pantalla de proyección.
 *
 * Devuelve el último ganador vigente —el que hay que mostrar en grande—
 * y el conteo de elegibles, que es lo que se anuncia antes de sortear.
 */
async function estado(db, requiereEntrada) {
  const { rows } = await db.query(
    `SELECT s.id AS sorteo_id, s.creado_en,
            p.id AS premio_id, p.nombre AS premio, p.patrocinador,
            a.nombre AS ganador, a.organismo
       FROM sorteos s
       JOIN premios p    ON p.id = s.premio_id
       JOIN asistentes a ON a.id = s.asistente_id
      WHERE s.estado = 'ganador'
      ORDER BY s.creado_en DESC
      LIMIT 1`
  );
  const { rows: pend } = await db.query(
    `SELECT count(*)::int AS n FROM premios p
      WHERE NOT EXISTS (
        SELECT 1 FROM sorteos s
         WHERE s.premio_id = p.id AND s.estado = 'ganador')`
  );
  return {
    ultimo: rows[0] || null,
    elegibles: await contarElegibles(db, requiereEntrada),
    pendientes: pend[0].n,
  };
}

/** El acta: todo lo que salió, en orden, incluidos los descartes. */
async function historial(db) {
  const { rows } = await db.query(
    `SELECT s.id, s.estado, s.creado_en, s.por,
            p.nombre AS premio, a.nombre AS ganador, a.organismo
       FROM sorteos s
       JOIN premios p    ON p.id = s.premio_id
       JOIN asistentes a ON a.id = s.asistente_id
      ORDER BY s.creado_en DESC`
  );
  return rows;
}

module.exports = {
  ESTADOS,
  condicionElegible,
  contarElegibles,
  listarPremios,
  crearPremio,
  borrarPremio,
  sortear,
  descartar,
  estado,
  historial,
};

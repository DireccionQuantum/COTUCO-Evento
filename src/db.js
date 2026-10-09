'use strict';

const { Pool } = require('pg');

/**
 * ¿La base está en esta misma máquina?
 *
 * Railway exige TLS; un PostgreSQL local de pruebas ni siquiera lo tiene
 * compilado y responde «The server does not support SSL connections».
 * Mirar sólo la palabra «localhost» no basta: la mitad de las veces la
 * cadena de pruebas trae 127.0.0.1 y entonces el arranque local falla con
 * un error que no dice nada de lo que pasa.
 */
function esLocal(url) {
  if (!url) return false;
  if (/^(disable|allow)$/i.test(process.env.PGSSLMODE || '')) return true;
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
           h === '0.0.0.0' || h.endsWith('.local');
  } catch (e) {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: esLocal(process.env.DATABASE_URL)
    ? false
    : { rejectUnauthorized: false },
  max: Number(process.env.PG_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado en el pool:', err.message);
});

/** Ejecuta una función dentro de una transacción, con rollback automático. */
async function enTransaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Lee toda la tabla config como objeto plano. */
async function leerConfig(ejecutor = pool) {
  const { rows } = await ejecutor.query('SELECT clave, valor FROM config');
  const out = {};
  for (const r of rows) out[r.clave] = r.valor;
  return out;
}

const esSi = (v) => String(v).toLowerCase() === 'si';

module.exports = { pool, enTransaccion, leerConfig, esSi, esLocal };

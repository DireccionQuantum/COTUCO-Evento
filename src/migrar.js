/**
 * Corre las migraciones de sql/ en orden.
 *
 * Todas son idempotentes, así que correr esto dos veces no hace daño:
 * es lo que permite desplegar sin pensar si ya se había migrado.
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  const dir = path.join(__dirname, '..', 'sql');
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const f of archivos) {
    process.stdout.write('  ' + f.padEnd(32));
    try {
      await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      console.log('ok');
    } catch (e) {
      console.log('FALLÓ');
      console.error('    ' + e.message);
      process.exit(1);
    }
  }

  console.log('\n  ' + archivos.length + ' migraciones aplicadas');
  await pool.end();
})();

/**
 * Crea o actualiza una cuenta del equipo.
 *
 *   node scripts/crear-usuario.js correo@dominio.mx "Nombre" admin "contraseña"
 *
 * Si la cuenta ya existe se le cambia la contraseña y el perfil. Eso es
 * lo que hace falta la noche anterior al evento, cuando alguien no se
 * acuerda de su clave.
 *
 * La contraseña va entre comillas: el hash de bcrypt lleva `$` y la
 * shell se come lo que sigue si se escribe suelta.
 */

'use strict';

require('dotenv').config();

const { pool } = require('../src/db');
const auth = require('../src/middleware/auth');

(async () => {
  const [email, nombre, rol, clave] = process.argv.slice(2);

  if (!email || !nombre || !rol || !clave) {
    console.log('\n  Uso:');
    console.log('    node scripts/crear-usuario.js <correo> <nombre> <perfil> <clave>');
    console.log('\n  Perfiles: ' + auth.ROLES.join(', '));
    console.log('\n  Ejemplo:');
    console.log('    node scripts/crear-usuario.js direccion@quantummkt.mx ' +
                '"Gabriel Torres" admin "mi-contraseña"\n');
    process.exit(1);
  }

  if (!auth.ROLES.includes(rol)) {
    console.error('  Perfil inválido. Usa uno de: ' + auth.ROLES.join(', '));
    process.exit(1);
  }

  const revisada = auth.revisarClave(clave);
  if (!revisada.ok) {
    console.error('  ' + revisada.motivo);
    process.exit(1);
  }

  try {
    const hash = await auth.hashear(clave);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol, activo)
            VALUES (lower($1), $2, $3, $4, true)
       ON CONFLICT (email) DO UPDATE
              SET nombre = EXCLUDED.nombre,
                  password_hash = EXCLUDED.password_hash,
                  rol = EXCLUDED.rol,
                  activo = true
        RETURNING id, email, nombre, rol, (xmax = 0) AS nuevo`,
      [String(email).trim(), String(nombre).trim(), hash, rol]
    );

    const u = rows[0];
    console.log('\n  ' + (u.nuevo ? 'Cuenta creada' : 'Cuenta actualizada'));
    console.log('    ' + u.nombre + ' <' + u.email + '> · perfil ' + u.rol + '\n');
  } catch (e) {
    console.error('  Falló: ' + e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

'use strict';

/**
 * Acceso al sistema — Registro de asistentes COTUCO
 *
 * Tres perfiles, cada uno con lo que necesita y nada más:
 *
 *   admin     Todo. Configura el evento, ve el padrón completo,
 *             cancela, exporta y da de alta usuarios.
 *   mesa      Registro en sitio e impresión de etiquetas. Busca gente y
 *             la da de alta, pero no exporta el padrón ni cancela.
 *   puerta    Sólo el lector. Ve quién llega y registra su ingreso. No
 *             ve correos ni teléfonos del resto de la lista.
 *   consulta  Mira y no toca: el resumen, el padrón y la exportación.
 *             Es el perfil del cliente —COTUCO quiere ir viendo cómo
 *             avanzan los registros—, y por eso no puede cancelar a
 *             nadie ni cerrar el formulario por accidente.
 *
 * `puerta` es a propósito el más restringido: esas cuentas van a estar
 * en los teléfonos de gente contratada para el día, y un teléfono se
 * pierde.
 */

const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const ROLES = ['admin', 'mesa', 'puerta', 'consulta'];

/**
 * Qué puede hacer cada perfil.
 *
 * `consulta` es el permiso de LECTURA del padrón; `admin` es el de
 * escritura. Que admin incluya consulta es lo que deja marcar las
 * pantallas de sólo mirar con el permiso chico sin quitarle nada al
 * administrador.
 */
const PERMISOS = {
  admin:    ['admin', 'mesa', 'puerta', 'consulta'],
  mesa:     ['mesa', 'puerta'],
  puerta:   ['puerta'],
  consulta: ['consulta'],
};

function puede(rol, permiso) {
  return (PERMISOS[rol] || []).includes(permiso);
}

/**
 * Tope de intentos de acceso.
 *
 * Va por correo y no por dirección de internet: el día del evento todo
 * el equipo va a estar en el mismo WiFi de la sede, y un tope por IP los
 * bloquearía entre sí en el peor momento. Así, quien se equivoca sólo se
 * afecta a sí mismo.
 */
const limiteAcceso = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    String((req.body && req.body.email) || '').trim().toLowerCase() || req.ip,
  message: { error: 'Demasiados intentos con este correo. Espera unos minutos.' },
});

/** Exige sesión con el permiso indicado. */
function exige(permiso) {
  return function (req, res, next) {
    const u = req.session && req.session.usuario;
    if (!u) return res.status(401).json({ error: 'Inicia sesión' });
    if (!u.activo) return res.status(403).json({ error: 'Tu cuenta está desactivada' });
    if (!puede(u.rol, permiso)) {
      return res.status(403).json({ error: 'Tu perfil no tiene acceso a esto' });
    }
    next();
  };
}

async function verificar(hash, clave) {
  try { return await bcrypt.compare(String(clave || ''), String(hash || '')); }
  catch (e) { return false; }
}

const hashear = (clave) => bcrypt.hash(String(clave), 10);

/* ------------------------------------------------------------------ *
 * Usuarios
 * ------------------------------------------------------------------ */

function limpiarEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) && s.length <= 120 ? s : null;
}

function limpiarNombre(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ');
  return s.length >= 2 && s.length <= 60 ? s : null;
}

/**
 * La clave la teclea alguien con prisa, a veces en un celular. Se pide
 * longitud, no una combinación imposible que acabe escrita en un papel
 * pegado a la mesa de registro.
 */
function revisarClave(v) {
  const s = String(v || '');
  if (s.length < 8) return { ok: false, motivo: 'Mínimo 8 caracteres' };
  if (s.length > 200) return { ok: false, motivo: 'Demasiado larga' };
  if (/^\d+$/.test(s)) return { ok: false, motivo: 'No puede ser sólo números' };
  return { ok: true, valor: s };
}

async function listar(db) {
  const { rows } = await db.query(
    `SELECT id, email, nombre, rol, activo, creado_en
       FROM usuarios ORDER BY rol, nombre`
  );
  return rows;
}

async function adminsActivos(db, exceptoId) {
  const { rows } = await db.query(
    `SELECT count(*)::int n FROM usuarios
      WHERE rol = 'admin' AND activo AND ($1::int IS NULL OR id <> $1)`,
    [exceptoId || null]
  );
  return rows[0].n;
}

async function crear(db, { email, nombre, rol, clave }) {
  const e = limpiarEmail(email);
  if (!e) return { error: 'Correo inválido' };
  const n = limpiarNombre(nombre);
  if (!n) return { error: 'El nombre debe tener al menos 2 letras' };
  const c = revisarClave(clave);
  if (!c.ok) return { error: c.motivo };
  const r = ROLES.includes(rol) ? rol : 'puerta';

  try {
    const { rows } = await db.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol)
       VALUES ($1,$2,$3,$4) RETURNING id, email, nombre, rol, activo, creado_en`,
      [e, n, await hashear(c.valor), r]
    );
    return { usuario: rows[0] };
  } catch (err) {
    if (err.code === '23505') return { error: 'Ese correo ya está registrado' };
    throw err;
  }
}

async function cambiarClave(db, id, clave) {
  const c = revisarClave(clave);
  if (!c.ok) return { error: c.motivo };
  const { rows } = await db.query(
    'UPDATE usuarios SET password_hash = $2 WHERE id = $1 RETURNING id, email, nombre',
    [id, await hashear(c.valor)]
  );
  return rows[0] ? { usuario: rows[0] } : { error: 'No encontrado' };
}

/**
 * Activar o desactivar. Desactivar es mejor que borrar: conserva el
 * rastro de quién recibió a quién en la puerta.
 */
async function cambiarActivo(db, id, activo, quienPide) {
  if (id === quienPide && !activo) {
    return { error: 'No puedes desactivar tu propia cuenta' };
  }
  if (!activo) {
    const { rows } = await db.query('SELECT rol FROM usuarios WHERE id = $1', [id]);
    if (rows[0] && rows[0].rol === 'admin' && (await adminsActivos(db, id)) === 0) {
      return { error: 'Debe quedar al menos un administrador activo' };
    }
  }
  const { rows } = await db.query(
    'UPDATE usuarios SET activo = $2 WHERE id = $1 RETURNING id, email, nombre, rol, activo',
    [id, !!activo]
  );
  return rows[0] ? { usuario: rows[0] } : { error: 'No encontrado' };
}

async function cambiarRol(db, id, rol, quienPide) {
  if (!ROLES.includes(rol)) return { error: 'Perfil inválido' };
  if (id === quienPide && rol !== 'admin') {
    return { error: 'No puedes quitarte a ti mismo el perfil de administrador' };
  }
  if (rol !== 'admin' && (await adminsActivos(db, id)) === 0) {
    return { error: 'Debe quedar al menos un administrador activo' };
  }
  const { rows } = await db.query(
    'UPDATE usuarios SET rol = $2 WHERE id = $1 RETURNING id, email, nombre, rol, activo',
    [id, rol]
  );
  return rows[0] ? { usuario: rows[0] } : { error: 'No encontrado' };
}

/**
 * Clave sugerida: dos palabras y dos dígitos. Se dicta por teléfono sin
 * deletrear y se teclea rápido, que es lo que hace falta cuando das de
 * alta a cinco personas el día anterior al evento.
 */
const PALABRAS = [
  'arena', 'bahia', 'cabo', 'duna', 'estero', 'faro', 'golfo', 'hotel',
  'isla', 'jacaranda', 'kiosco', 'litoral', 'mirador', 'nogal', 'olivo',
  'puerto', 'quinta', 'rambla', 'sendero', 'terraza', 'uva', 'valle',
  'xolo', 'zocalo', 'cañon', 'mesa', 'playa', 'vino',
];

function claveSugerida() {
  const crypto = require('crypto');
  const elige = (a) => a[crypto.randomInt(a.length)];
  return `${elige(PALABRAS)}-${elige(PALABRAS)}-${crypto.randomInt(10, 100)}`;
}

module.exports = {
  ROLES, PERMISOS, puede,
  limiteAcceso, exige,
  verificar, hashear,
  limpiarEmail, limpiarNombre, revisarClave,
  listar, crear, cambiarClave, cambiarActivo, cambiarRol,
  adminsActivos, claveSugerida,
};

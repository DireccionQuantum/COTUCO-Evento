/**
 * Registro de asistentes — COTUCO
 *
 * Una persona abre el enlace, llena cinco campos y recibe su código y su
 * QR. No hay acompañantes: cada quien se registra por su cuenta, y eso
 * simplifica todo lo demás —un código, una fila, una etiqueta.
 *
 * El mismo módulo sirve para el alta en línea y para la mesa de registro
 * del día del evento. La única diferencia es `origen` y que en la mesa el
 * correo deja de ser obligatorio: a nadie se le niega el acceso por no
 * acordarse de su correo con la fila detrás.
 */

'use strict';

const crypto = require('crypto');

const TIPOS = ['general', 'proveedor'];

const ETIQUETA_TIPO = {
  general: 'Invitado general',
  proveedor: 'Cadena de valor · Proveedor',
};

/* ------------------------------------------------------------------ *
 * Limpieza de lo que llega del formulario
 * ------------------------------------------------------------------ */

/**
 * Quita los caracteres invisibles que se cuelan al copiar de WhatsApp,
 * Word o un correo. No se ven, pero rompen las comparaciones: dos
 * nombres idénticos a la vista dejan de serlo para la base.
 */
function texto(v, max) {
  if (v == null) return null;
  const s = String(v)
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/ /g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
}

function correo(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) && s.length <= 120 ? s : null;
}

/**
 * Teléfono a diez dígitos.
 *
 * Se aceptan todas las formas en que la gente lo escribe —con lada
 * internacional, con guiones, con paréntesis— y se guarda sólo el
 * número. Si trae más de diez dígitos se toman los últimos: el +52 de
 * México sobra. Los números de San Diego entran igual con sus diez.
 */
function telefono(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  const diez = d.length > 10 ? d.slice(-10) : d;
  return diez.length === 10 ? diez : null;
}

function tipoDe(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return TIPOS.includes(s) ? s : null;
}

function limpiar(b) {
  return {
    nombre: texto(b.nombre, 90),
    cargo: texto(b.cargo, 80),
    organismo: texto(b.organismo, 120),
    telefono: telefono(b.telefono),
    email: correo(b.email),
    tipo: tipoDe(b.tipo),
  };
}

/**
 * Revisa los datos.
 *
 * Obligatorios: nombre, organismo y tipo. El nombre y el organismo
 * porque son lo que se imprime en la etiqueta —una etiqueta sin
 * organismo no sirve de nada en un evento de networking—, y el tipo
 * porque decide cómo se recibe a la persona en la puerta.
 *
 * El correo es obligatorio en línea y opcional en la mesa: en línea es
 * el único respaldo que tiene alguien si pierde su pase; en la mesa, la
 * persona ya está parada enfrente y su etiqueta sale al momento.
 */
function validar(d, crudo = {}, opts = {}) {
  const errores = {};

  if (!d.nombre || d.nombre.length < 3) {
    errores.nombre = 'Escribe tu nombre completo';
  } else if (!/\s/.test(d.nombre)) {
    errores.nombre = 'Falta tu apellido';
  }

  if (!d.organismo || d.organismo.length < 2) {
    errores.organismo = 'Escribe tu organismo o empresa';
  }

  if (!d.tipo) {
    errores.tipo = 'Elige si eres invitado general o proveedor';
  }

  if (!d.telefono && !opts.enMesa) {
    errores.telefono = crudo.telefono && String(crudo.telefono).trim()
      ? 'Deben ser diez dígitos'
      : 'Escribe tu teléfono';
  } else if (!d.telefono && crudo.telefono && String(crudo.telefono).trim()) {
    errores.telefono = 'Deben ser diez dígitos';
  }

  if (!d.email && !opts.enMesa) {
    errores.email = crudo.email && String(crudo.email).trim()
      ? 'Ese correo no se ve bien'
      : 'Necesitamos tu correo para enviarte el pase';
  } else if (!d.email && crudo.email && String(crudo.email).trim()) {
    errores.email = 'Ese correo no se ve bien';
  }

  return Object.keys(errores).length ? errores : null;
}

/* ------------------------------------------------------------------ *
 * Códigos
 * ------------------------------------------------------------------ */

// Sin O/0 ni I/1/L: alguien va a dictar su código por teléfono o a
// teclearlo a mano, y esas confusiones cuestan tiempo en la puerta.
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Ocho caracteres del alfabeto, sin sesgo.
 *
 * `byte % 31` haría un 12 % más probables los primeros ocho caracteres,
 * porque 256 no es múltiplo de 31. Se descarta el sobrante para que la
 * distribución quede plana: cuesta unos bytes más y quita una rareza
 * que nadie quiere estar explicando después.
 */
function generarCodigo() {
  const n = ALFABETO.length;          // 31
  const tope = 256 - (256 % n);       // 248
  let s = '';
  while (s.length < 8) {
    for (const b of crypto.randomBytes(16)) {
      if (b >= tope) continue;
      s += ALFABETO[b % n];
      if (s.length === 8) break;
    }
  }
  return s;
}

/**
 * Normaliza lo que llega del lector o de un campo escrito a mano.
 *
 * El QR lleva sólo el código, pero conviene tolerar que venga dentro de
 * algo más: una liga como «.../pase?c=K7M2Q9X4» o un código pegado a
 * otro texto. Se busca el ÚLTIMO grupo de ocho, no el primero: una
 * dirección termina con el código, y tomar el primero devolvería un
 * pedazo del dominio.
 */
function limpiarCodigo(v) {
  const s = String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!s) return null;

  // Lo más común con diferencia: el código solo, tal cual.
  if (/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(s)) return s;

  const cola = s.slice(-8);
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(cola) ? cola : null;
}

/* ------------------------------------------------------------------ *
 * Alta
 * ------------------------------------------------------------------ */

/**
 * Registra a una persona.
 *
 * Si el correo ya se había registrado se le devuelve SU pase en vez de
 * crear otro. Alguien que abre el enlace dos veces no quiere dos
 * lugares: quiere volver a ver el suyo.
 */
async function registrar(client, cuerpo, opts = {}) {
  const d = limpiar(cuerpo);
  const errores = validar(d, cuerpo, opts);
  if (errores) return { ok: false, errores };

  if (d.email) {
    const previo = await client.query(
      `SELECT id, nombre, cargo, organismo, tipo, codigo
         FROM asistentes
        WHERE cancelado_en IS NULL AND lower(btrim(email)) = $1`,
      [d.email]
    );
    if (previo.rows[0]) {
      return { ok: true, yaEstaba: true, asistente: previo.rows[0] };
    }
  }

  // Ocho intentos por si sale un código repetido. Con 31^8 combinaciones
  // es improbable, pero cada intento va dentro de un SAVEPOINT: en
  // PostgreSQL cualquier error aborta la transacción entera, así que sin
  // punto de retorno la primera colisión tiraría todo el registro.
  for (let intento = 0; intento < 8; intento++) {
    await client.query('SAVEPOINT alta');
    try {
      const { rows } = await client.query(
        `INSERT INTO asistentes
           (nombre, cargo, organismo, telefono, email, tipo, codigo, origen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, nombre, cargo, organismo, telefono, email, tipo,
                   codigo, origen, registrado_en`,
        [d.nombre, d.cargo, d.organismo, d.telefono, d.email, d.tipo,
         generarCodigo(), opts.origen || 'linea']
      );
      await client.query('RELEASE SAVEPOINT alta');
      return { ok: true, yaEstaba: false, asistente: rows[0] };
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT alta');
      // 23505 es violación de índice único. Si fue por el correo, es que
      // alguien se registró en el mismo instante desde otra pestaña.
      if (e.code !== '23505') throw e;
      if (e.constraint === 'uq_asi_email') {
        return { ok: false, errores: { email: 'Ese correo ya está registrado' } };
      }
    }
  }
  return { ok: false, errores: { general: 'No se pudo generar el pase' } };
}

/* ------------------------------------------------------------------ *
 * Consulta del pase
 * ------------------------------------------------------------------ */

/** Devuelve el pase de alguien por su código, para que lo vuelva a ver. */
async function porCodigo(db, codigo) {
  const c = limpiarCodigo(codigo);
  if (!c) return null;

  const { rows } = await db.query(
    `SELECT id, nombre, cargo, organismo, tipo, codigo,
            llego_en, cancelado_en, impreso_en, impresiones
       FROM asistentes WHERE codigo = $1`,
    [c]
  );
  return rows[0] || null;
}

/** Busca el pase por correo, para quien perdió su enlace. */
async function porCorreo(db, email) {
  const e = correo(email);
  if (!e) return null;

  const { rows } = await db.query(
    `SELECT id, nombre, cargo, organismo, tipo, codigo
       FROM asistentes
      WHERE cancelado_en IS NULL AND lower(btrim(email)) = $1`,
    [e]
  );
  return rows[0] || null;
}

/**
 * Búsqueda para la mesa de registro: por nombre, organismo, correo,
 * teléfono o código. Devuelve pocos resultados a propósito —quien
 * atiende la mesa necesita una respuesta, no una lista para leer.
 */
async function buscar(db, q) {
  const t = String(q || '').trim();
  if (t.length < 2) return [];

  const codigo = limpiarCodigo(t);
  // Los comodines se escapan: buscar «100%» traería todo el padrón.
  const like = t.replace(/([%_\\])/g, '\\$1');
  // Si lo tecleado no trae dígitos, la rama del teléfono tiene que no
  // casar con nada. El centinela es un guion y no un byte nulo: el nulo
  // no cabe en un texto de PostgreSQL y tiraba la consulta entera con
  // «invalid byte sequence for encoding UTF8», así que buscar por nombre
  // fallaba mientras buscar por teléfono funcionaba.
  const soloDigitos = t.replace(/\D/g, '') || '-';

  const { rows } = await db.query(
    `SELECT id, nombre, cargo, organismo, telefono, email, tipo, codigo,
            llego_en, cancelado_en, impreso_en
       FROM asistentes
      WHERE codigo = $2
         OR sin_acentos(nombre || ' ' || organismo || ' ' ||
                        COALESCE(cargo,'') || ' ' || COALESCE(email,''))
              LIKE '%' || sin_acentos($1) || '%' ESCAPE '\\'
         OR COALESCE(telefono,'') LIKE '%' || $3 || '%'
      ORDER BY cancelado_en NULLS FIRST, nombre
      LIMIT 12`,
    [like, codigo || '', soloDigitos]
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Puerta
 * ------------------------------------------------------------------ */

/**
 * Registra la llegada de alguien.
 *
 * Devuelve `resultado`:
 *   'entrada'    → primera vez, pasa
 *   'repetido'   → ya había entrado; se avisa pero no se bloquea,
 *                  porque la gente sale y vuelve a entrar
 *   'cancelado'  → se registró y luego canceló
 *   'sin_codigo' → el código no existe
 *
 * La diferencia entre avisar y bloquear importa: nadie quiere que le
 * nieguen el paso por volver de contestar una llamada afuera.
 */
async function registrarLlegada(client, codigo, usuario) {
  const c = limpiarCodigo(codigo);
  if (!c) return { ok: false, resultado: 'sin_codigo' };

  const { rows } = await client.query(
    `SELECT id, nombre, cargo, organismo, tipo, codigo,
            llego_en, cancelado_en, impreso_en
       FROM asistentes WHERE codigo = $1 FOR UPDATE`,
    [c]
  );
  const a = rows[0];
  if (!a) return { ok: false, resultado: 'sin_codigo' };

  if (a.cancelado_en) {
    await client.query(
      `INSERT INTO accesos (asistente_id, resultado, por) VALUES ($1,'cancelado',$2)`,
      [a.id, usuario || null]
    );
    return { ok: false, resultado: 'cancelado', asistente: a };
  }

  if (a.llego_en) {
    await client.query(
      `INSERT INTO accesos (asistente_id, resultado, por) VALUES ($1,'repetido',$2)`,
      [a.id, usuario || null]
    );
    return { ok: true, resultado: 'repetido', asistente: a };
  }

  const { rows: act } = await client.query(
    `UPDATE asistentes SET llego_en = now(), llego_por = $2
      WHERE id = $1
      RETURNING id, nombre, cargo, organismo, tipo, codigo,
                llego_en, impreso_en`,
    [a.id, usuario || null]
  );
  await client.query(
    `INSERT INTO accesos (asistente_id, resultado, por) VALUES ($1,'entrada',$2)`,
    [a.id, usuario || null]
  );

  return { ok: true, resultado: 'entrada', asistente: act[0] };
}

/**
 * Marca que se imprimió la etiqueta de alguien.
 *
 * Se lleva la cuenta en vez de un simple sí/no porque una reimpresión
 * es información: dice que la primera salió mal, que la persona perdió
 * el carnet, o que alguien está imprimiendo de más. Al cierre también
 * sirve para saber cuánto rollo se gastó.
 */
async function marcarImpresa(db, codigo) {
  const c = limpiarCodigo(codigo);
  if (!c) return { ok: false, error: 'Código inválido' };

  const { rows } = await db.query(
    `UPDATE asistentes
        SET impreso_en = now(), impresiones = impresiones + 1
      WHERE codigo = $1 AND cancelado_en IS NULL
      RETURNING id, nombre, codigo, impresiones`,
    [c]
  );
  if (!rows[0]) return { ok: false, error: 'No encontrado o cancelado' };
  return { ok: true, asistente: rows[0] };
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

/** Lista de registrados, con búsqueda y filtros. */
async function listar(db, { q = '', filtro = 'todos', pagina = 1 } = {}) {
  const porPagina = 50;
  const p = Math.max(1, parseInt(pagina, 10) || 1);

  const donde = ['1=1'];
  const args = [];

  const t = String(q || '').trim();
  if (t) {
    args.push(t.replace(/([%_\\])/g, '\\$1'));
    args.push(limpiarCodigo(t) || '');
    // Un guion, no un byte nulo: ver la nota en buscar().
    args.push(t.replace(/\D/g, '') || '-');
    donde.push(
      `(sin_acentos(a.nombre || ' ' || a.organismo || ' ' ||
                    COALESCE(a.cargo,'') || ' ' || COALESCE(a.email,''))
          LIKE '%' || sin_acentos($1) || '%' ESCAPE '\\'
        OR a.codigo = $2
        OR COALESCE(a.telefono,'') LIKE '%' || $3 || '%')`
    );
  }

  const filtros = {
    generales:   "a.tipo = 'general' AND a.cancelado_en IS NULL",
    proveedores: "a.tipo = 'proveedor' AND a.cancelado_en IS NULL",
    llegaron:    'a.llego_en IS NOT NULL AND a.cancelado_en IS NULL',
    faltan:      'a.llego_en IS NULL AND a.cancelado_en IS NULL',
    impresas:    'a.impreso_en IS NOT NULL AND a.cancelado_en IS NULL',
    mesa:        "a.origen = 'mesa' AND a.cancelado_en IS NULL",
    cancelados:  'a.cancelado_en IS NOT NULL',
    todos:       'a.cancelado_en IS NULL',
  };
  donde.push(filtros[filtro] || filtros.todos);

  const cond = donde.join(' AND ');

  const [total, filas] = await Promise.all([
    db.query(`SELECT count(*)::int AS n FROM asistentes a WHERE ${cond}`, args),
    db.query(
      `SELECT a.id, a.nombre, a.cargo, a.organismo, a.telefono, a.email,
              a.tipo, a.codigo, a.origen, a.llego_en, a.cancelado_en,
              a.impreso_en, a.impresiones,
              to_char(a.registrado_en AT TIME ZONE 'America/Tijuana',
                      'DD/MM HH24:MI') AS registro
         FROM asistentes a
        WHERE ${cond}
        ORDER BY a.registrado_en DESC
        LIMIT ${porPagina} OFFSET ${(p - 1) * porPagina}`, args),
  ]);

  return {
    total: total.rows[0].n,
    pagina: p,
    paginas: Math.max(1, Math.ceil(total.rows[0].n / porPagina)),
    asistentes: filas.rows,
  };
}

/** Cancela un registro sin borrarlo: queda el rastro. */
async function cancelar(client, id) {
  const { rows } = await client.query(
    `UPDATE asistentes SET cancelado_en = now()
      WHERE id = $1 AND cancelado_en IS NULL
      RETURNING id, nombre, organismo`,
    [id]
  );
  if (!rows[0]) return { ok: false, error: 'No encontrado o ya cancelado' };
  return { ok: true, asistente: rows[0] };
}

/** Deshace una cancelación, por si se tocó el botón por error. */
async function reactivar(client, id) {
  const { rows } = await client.query(
    `UPDATE asistentes SET cancelado_en = NULL
      WHERE id = $1 AND cancelado_en IS NOT NULL
      RETURNING id, nombre, organismo`,
    [id]
  );
  if (!rows[0]) return { ok: false, error: 'No encontrado o ya está activo' };
  return { ok: true, asistente: rows[0] };
}

module.exports = {
  TIPOS,
  ETIQUETA_TIPO,
  ALFABETO,
  texto,
  correo,
  telefono,
  tipoDe,
  limpiar,
  validar,
  generarCodigo,
  limpiarCodigo,
  registrar,
  porCodigo,
  porCorreo,
  buscar,
  registrarLlegada,
  marcarImpresa,
  listar,
  cancelar,
  reactivar,
};

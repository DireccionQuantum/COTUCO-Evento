/**
 * Registro de asistentes · COTUCO
 * Comité de Turismo y Convenciones de Tijuana
 *
 * Registro en línea con QR individual, mesa de registro en sitio,
 * control de acceso en la puerta e impresión de etiquetas Brother QL
 * para los carnets.
 */

'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const PgSesion = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');

const { pool, enTransaccion, leerConfig, esSi } = require('./db');
const reg = require('./services/registros');
const auth = require('./middleware/auth');

const app = express();
const PUBLICO = path.join(__dirname, '..', 'public');

app.set('trust proxy', 1);   // va detrás del proxy de Railway

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Los estilos en línea se usan para alturas de barras y estados;
      // pasarlo todo a clases para un evento de un día no se paga.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '256kb' }));

app.use(session({
  store: new PgSesion({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'cambiar-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 14 * 24 * 60 * 60 * 1000,   // dos semanas: cubre el montaje
  },
}));

app.use(express.static(PUBLICO, { maxAge: '1h', index: false }));

const pagina = (archivo) => (req, res) => res.sendFile(path.join(PUBLICO, archivo));

/** Lo que el pase devuelve al navegador. Nunca el correo ni el teléfono. */
function pasePublico(a) {
  return {
    nombre: a.nombre,
    cargo: a.cargo,
    organismo: a.organismo,
    tipo: a.tipo,
    tipo_texto: reg.ETIQUETA_TIPO[a.tipo] || '',
    codigo: a.codigo,
  };
}

/* ================= Datos del evento (público) ================= */

app.get('/api/evento', async (req, res, next) => {
  try {
    const c = await leerConfig();
    res.json({
      evento: c.evento || '',
      lema: c.lema || '',
      sede: c.sede || '',
      direccion: c.direccion || '',
      fecha: c.fecha || '',
      hora: c.hora || '',
      abierto: esSi(c.registros_abiertos),
    });
  } catch (err) { next(err); }
});

/* ================= Registro (público) ================= */

/**
 * Límite de intentos.
 *
 * El formulario está abierto en internet. Sin freno, alguien podría
 * llenar la lista con registros falsos y dejar a COTUCO sin saber
 * cuánta gente esperar.
 */
const limitePublico = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' },
});

app.post('/api/registro', limitePublico, async (req, res, next) => {
  try {
    const c = await leerConfig();
    if (!esSi(c.registros_abiertos)) {
      return res.status(409).json({
        error: 'Los registros ya cerraron. Comunícate con COTUCO.',
      });
    }

    // El cupo se revisa antes de insertar. No es una carrera perfecta
    // —dos altas simultáneas en el último lugar pasarían las dos—, pero
    // pelear por eso con bloqueos de tabla cuesta más de lo que vale:
    // un asistente de más en un evento de cientos no rompe nada.
    const cupo = parseInt(c.cupo, 10);
    if (Number.isInteger(cupo) && cupo > 0) {
      const { rows } = await pool.query('SELECT registrados FROM v_resumen');
      if (rows[0] && rows[0].registrados >= cupo) {
        return res.status(409).json({
          error: 'Se agotaron los lugares. Comunícate con COTUCO.',
        });
      }
    }

    const r = await enTransaccion((cl) => reg.registrar(cl, req.body || {}));
    if (!r.ok) return res.status(422).json(r);
    res.json({
      ok: true,
      yaEstaba: r.yaEstaba,
      asistente: pasePublico(r.asistente),
    });
  } catch (err) { next(err); }
});

/** Consulta de un pase por su código, para volver a verlo. */
app.get('/api/pase/:codigo', limitePublico, async (req, res, next) => {
  try {
    const a = await reg.porCodigo(pool, req.params.codigo);
    if (!a || a.cancelado_en) {
      return res.status(404).json({ error: 'No encontrado' });
    }
    res.json({ asistente: pasePublico(a) });
  } catch (err) { next(err); }
});

/** Recuperar el pase con el correo, para quien perdió su enlace. */
app.get('/api/mi-pase', limitePublico, async (req, res, next) => {
  try {
    const a = await reg.porCorreo(pool, req.query.email);
    res.json({ asistente: a ? pasePublico(a) : null });
  } catch (err) { next(err); }
});

/* ================= Sesión del personal ================= */

app.post('/api/entrar', auth.limiteAcceso, async (req, res, next) => {
  try {
    const { email, clave } = req.body || {};
    const { rows } = await pool.query(
      `SELECT id, email, nombre, password_hash, rol, activo
         FROM usuarios WHERE lower(email) = lower($1)`,
      [String(email || '').trim()]
    );
    const u = rows[0];
    // Mismo mensaje exista o no la cuenta: no se confirma qué correos
    // están dados de alta.
    if (!u || !u.activo || !(await auth.verificar(u.password_hash, clave))) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    // `activo` va en la sesión porque el middleware lo revisa en cada
    // petición: si se omite, toda cuenta parece desactivada.
    req.session.usuario = {
      id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, activo: true,
    };
    res.json({ ok: true, usuario: req.session.usuario });
  } catch (err) { next(err); }
});

app.post('/api/salir', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/sesion', (req, res) => {
  res.json({ usuario: req.session.usuario || null });
});

/* ================= Puerta ================= */

app.post('/api/llegada', auth.exige('puerta'), async (req, res, next) => {
  try {
    const r = await enTransaccion((c) =>
      reg.registrarLlegada(c, (req.body || {}).codigo,
        req.session.usuario.email));
    res.json(r);
  } catch (err) { next(err); }
});

app.get('/api/puerta/resumen', auth.exige('puerta'), async (req, res, next) => {
  try {
    const [resumen, ultimos, cfg] = await Promise.all([
      pool.query('SELECT * FROM v_resumen'),
      pool.query(
        `SELECT nombre, organismo, tipo,
                to_char(llego_en AT TIME ZONE 'America/Tijuana', 'HH24:MI') AS hora
           FROM asistentes
          WHERE llego_en IS NOT NULL
          ORDER BY llego_en DESC LIMIT 6`),
      leerConfig(),
    ]);
    res.json({
      resumen: resumen.rows[0],
      ultimos: ultimos.rows,
      etiqueta_en_puerta: esSi(cfg.etiqueta_en_puerta),
    });
  } catch (err) { next(err); }
});

/* ================= Mesa de registro ================= */

/** Alta en sitio: el correo deja de ser obligatorio. */
app.post('/api/mesa/registro', auth.exige('mesa'), async (req, res, next) => {
  try {
    const r = await enTransaccion((c) =>
      reg.registrar(c, req.body || {}, { origen: 'mesa', enMesa: true }));
    if (!r.ok) return res.status(422).json(r);
    res.json({
      ok: true,
      yaEstaba: r.yaEstaba,
      asistente: pasePublico(r.asistente),
    });
  } catch (err) { next(err); }
});

/** Búsqueda rápida para reimprimir o para encontrar a alguien. */
app.get('/api/mesa/buscar', auth.exige('mesa'), async (req, res, next) => {
  try {
    res.json({ resultados: await reg.buscar(pool, req.query.q) });
  } catch (err) { next(err); }
});

/** Deja constancia de que la etiqueta salió. */
app.post('/api/etiqueta/impresa', auth.exige('puerta'), async (req, res, next) => {
  try {
    const r = await reg.marcarImpresa(pool, (req.body || {}).codigo);
    if (!r.ok) return res.status(404).json(r);
    res.json(r);
  } catch (err) { next(err); }
});

/**
 * Datos para la etiqueta. Va con permiso de `puerta` porque la estación
 * de impresión puede estar atendida por el mismo personal del acceso.
 */
app.get('/api/etiqueta/:codigo', auth.exige('puerta'), async (req, res, next) => {
  try {
    const a = await reg.porCodigo(pool, req.params.codigo);
    if (!a) return res.status(404).json({ error: 'No encontrado' });
    if (a.cancelado_en) {
      return res.status(409).json({ error: 'Ese registro está cancelado' });
    }
    res.json({ asistente: pasePublico(a) });
  } catch (err) { next(err); }
});

/* ================= Panel ================= */

app.get('/api/panel/resumen', auth.exige('admin'), async (req, res, next) => {
  try {
    const [resumen, porDia, cfg] = await Promise.all([
      pool.query('SELECT * FROM v_resumen'),
      pool.query(
        // El to_char debe calcularse sobre la MISMA expresión que agrupa,
        // no sobre la columna cruda: si no, PostgreSQL no sabe qué valor
        // tomar de cada grupo y rechaza la consulta.
        `SELECT to_char((registrado_en AT TIME ZONE 'America/Tijuana')::date,
                        'DD/MM') AS dia,
                count(*) FILTER (WHERE tipo = 'general')::int   AS generales,
                count(*) FILTER (WHERE tipo = 'proveedor')::int AS proveedores,
                count(*)::int AS total
           FROM asistentes
          WHERE cancelado_en IS NULL
          GROUP BY (registrado_en AT TIME ZONE 'America/Tijuana')::date
          ORDER BY (registrado_en AT TIME ZONE 'America/Tijuana')::date`),
      leerConfig(),
    ]);
    res.json({ resumen: resumen.rows[0], por_dia: porDia.rows, config: cfg });
  } catch (err) { next(err); }
});

app.get('/api/asistentes', auth.exige('admin'), async (req, res, next) => {
  try {
    res.json(await reg.listar(pool, {
      q: req.query.q,
      filtro: req.query.filtro,
      pagina: req.query.pagina,
    }));
  } catch (err) { next(err); }
});

app.post('/api/asistentes/:id/cancelar', auth.exige('admin'),
  async (req, res, next) => {
    try {
      const r = await enTransaccion((c) =>
        reg.cancelar(c, parseInt(req.params.id, 10)));
      if (!r.ok) return res.status(422).json(r);
      res.json(r);
    } catch (err) { next(err); }
  });

app.post('/api/asistentes/:id/reactivar', auth.exige('admin'),
  async (req, res, next) => {
    try {
      const r = await enTransaccion((c) =>
        reg.reactivar(c, parseInt(req.params.id, 10)));
      if (!r.ok) return res.status(422).json(r);
      res.json(r);
    } catch (err) { next(err); }
  });

/** Lista completa para Excel. */
app.get('/api/asistentes.csv', auth.exige('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.nombre, a.cargo, a.organismo, a.telefono, a.email,
              CASE a.tipo WHEN 'general' THEN 'Invitado general'
                          ELSE 'Cadena de valor / Proveedor' END AS tipo,
              a.codigo,
              CASE WHEN a.origen = 'mesa' THEN 'Mesa' ELSE 'En línea' END
                AS origen,
              CASE WHEN a.llego_en IS NOT NULL THEN 'Sí' ELSE 'No' END AS llego,
              to_char(a.llego_en AT TIME ZONE 'America/Tijuana',
                      'DD/MM HH24:MI') AS hora_llegada,
              a.impresiones,
              CASE WHEN a.cancelado_en IS NOT NULL THEN 'Sí' ELSE 'No' END
                AS cancelado,
              to_char(a.registrado_en AT TIME ZONE 'America/Tijuana',
                      'DD/MM/YYYY HH24:MI') AS registro
         FROM asistentes a
        ORDER BY a.registrado_en`);

    const col = ['nombre', 'cargo', 'organismo', 'telefono', 'email', 'tipo',
                 'codigo', 'origen', 'llego', 'hora_llegada', 'impresiones',
                 'cancelado', 'registro'];
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = [col.join(',')]
      .concat(rows.map((r) => col.map((c) => esc(r[c])).join(','))).join('\n');

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition',
      'attachment; filename="registrados-cotuco.csv"');
    res.send('﻿' + csv);   // BOM para que Excel abra bien los acentos
  } catch (err) { next(err); }
});

/* ---- Ajustes del evento ---- */

const CLAVES = ['evento', 'lema', 'sede', 'direccion', 'fecha', 'hora',
                'registros_abiertos', 'cupo', 'etiqueta_en_puerta'];

app.post('/api/config', auth.exige('admin'), async (req, res, next) => {
  try {
    const cambios = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const k of CLAVES) {
        if (!(k in cambios)) continue;
        await client.query(
          `INSERT INTO config (clave, valor) VALUES ($1,$2)
           ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
          [k, String(cambios[k] == null ? '' : cambios[k]).slice(0, 200)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, config: await leerConfig() });
  } catch (err) { next(err); }
});

/* ---- Usuarios ---- */

app.get('/api/usuarios', auth.exige('admin'), async (req, res, next) => {
  try {
    res.json({ usuarios: await auth.listar(pool), sugerida: auth.claveSugerida() });
  } catch (err) { next(err); }
});

app.post('/api/usuarios', auth.exige('admin'), async (req, res, next) => {
  try {
    const r = await auth.crear(pool, req.body || {});
    if (r.error) return res.status(422).json({ error: r.error });
    res.json({ ok: true, usuario: r.usuario });
  } catch (err) { next(err); }
});

app.post('/api/usuarios/:id/clave', auth.exige('admin'), async (req, res, next) => {
  try {
    const r = await auth.cambiarClave(pool, parseInt(req.params.id, 10),
      (req.body || {}).clave);
    if (r.error) return res.status(422).json({ error: r.error });
    res.json({ ok: true, usuario: r.usuario });
  } catch (err) { next(err); }
});

app.post('/api/usuarios/:id/activo', auth.exige('admin'), async (req, res, next) => {
  try {
    const r = await auth.cambiarActivo(pool, parseInt(req.params.id, 10),
      !!(req.body || {}).activo, req.session.usuario.id);
    if (r.error) return res.status(422).json({ error: r.error });
    res.json({ ok: true, usuario: r.usuario });
  } catch (err) { next(err); }
});

app.post('/api/usuarios/:id/rol', auth.exige('admin'), async (req, res, next) => {
  try {
    const r = await auth.cambiarRol(pool, parseInt(req.params.id, 10),
      (req.body || {}).rol, req.session.usuario.id);
    if (r.error) return res.status(422).json({ error: r.error });
    res.json({ ok: true, usuario: r.usuario });
  } catch (err) { next(err); }
});

/* ================= Páginas ================= */

app.get('/',          pagina('index.html'));     // registro público
app.get('/puerta',    pagina('puerta.html'));    // lector de accesos
app.get('/mesa',      pagina('mesa.html'));      // registro en sitio
app.get('/etiqueta',  pagina('etiqueta.html'));  // una etiqueta Brother QL
app.get('/panel',     pagina('panel.html'));     // administración

app.get('/api/salud', (req, res) => res.json({ ok: true }));

/* ================= Errores ================= */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  res.redirect('/');
});

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Algo falló. Inténtalo otra vez.' });
});

const PUERTO = process.env.PORT || 8080;
app.listen(PUERTO, () => {
  console.log(`  Registro COTUCO — http://localhost:${PUERTO}`);
});

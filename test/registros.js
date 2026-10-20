/**
 * Pruebas del registro — COTUCO
 *
 * Sin base de datos: todo lo que se prueba aquí son las funciones puras,
 * que es donde han salido los errores que cuestan caro el día del evento.
 *
 *   node test/registros.js
 */

'use strict';

const assert = require('assert');
const reg = require('../src/services/registros');

let hechas = 0;
const pendientes = [];

function bien(nombre) { hechas++; console.log('  ok   ' + nombre); }
function mal(nombre, e) {
  console.log('  FALLÓ ' + nombre);
  console.log('        ' + e.message);
  process.exitCode = 1;
}

/**
 * Corre una prueba. Si devuelve una promesa se espera al final, en vez
 * de darla por buena: una prueba asíncrona que no se espera pasa siempre,
 * y una prueba que siempre pasa no sirve de nada.
 */
function prueba(nombre, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pendientes.push(r.then(
        function () { bien(nombre); },
        function (e) { mal(nombre, e); }
      ));
      return;
    }
    bien(nombre);
  } catch (e) {
    mal(nombre, e);
  }
}

console.log('\n  Registro de asistentes · COTUCO\n');

/* ---------------- Limpieza de texto ---------------- */

prueba('texto quita espacios dobles y recorta', () => {
  assert.strictEqual(reg.texto('  Juan   Pérez  ', 60), 'Juan Pérez');
});

prueba('texto quita los invisibles que se pegan al copiar de WhatsApp', () => {
  assert.strictEqual(reg.texto('​Hotel Lucerna﻿', 60),
    'Hotel Lucerna');
});

prueba('texto devuelve null cuando no queda nada', () => {
  assert.strictEqual(reg.texto('   ', 60), null);
  assert.strictEqual(reg.texto(null, 60), null);
});

prueba('texto respeta el tope de largo', () => {
  assert.strictEqual(reg.texto('a'.repeat(200), 60).length, 60);
});

/* ---------------- Correo ---------------- */

prueba('correo acepta uno normal y lo pasa a minúsculas', () => {
  assert.strictEqual(reg.correo('  Contacto@COTUCO.MX '), 'contacto@cotuco.mx');
});

prueba('correo rechaza lo que no lo es', () => {
  ['', 'sin-arroba', 'a@b', 'a@b.c', 'dos@@dominio.mx', null]
    .forEach((v) => assert.strictEqual(reg.correo(v), null, 'con ' + v));
});

/* ---------------- Teléfono ---------------- */

prueba('teléfono acepta las formas en que la gente lo escribe', () => {
  ['6641234567', '664 123 4567', '664-123-4567', '(664) 123 4567',
   '+52 664 123 4567', '52 664 123 4567', '01 664 123 4567']
    .forEach((v) => assert.strictEqual(reg.telefono(v), '6641234567', 'con ' + v));
});

prueba('teléfono rechaza los que no llegan a diez dígitos', () => {
  ['', '664123', '12345', null].forEach((v) =>
    assert.strictEqual(reg.telefono(v), null, 'con ' + v));
});

/* ---------------- Tipo ---------------- */

prueba('tipo acepta sólo los dos válidos', () => {
  assert.strictEqual(reg.tipoDe('general'), 'general');
  assert.strictEqual(reg.tipoDe('PROVEEDOR'), 'proveedor');
  assert.strictEqual(reg.tipoDe('invitado'), null);
  assert.strictEqual(reg.tipoDe(''), null);
  assert.strictEqual(reg.tipoDe(undefined), null);
});

/* ---------------- Validación ---------------- */

const bueno = {
  nombre: 'Ana María Rodríguez',
  organismo: 'Hotel Lucerna',
  telefono: '6641234567',
  email: 'ana@lucerna.mx',
  tipo: 'general',
};

prueba('un registro completo pasa', () => {
  assert.strictEqual(reg.validar(reg.limpiar(bueno), bueno), null);
});

prueba('el cargo no es obligatorio', () => {
  const sin = Object.assign({}, bueno);
  delete sin.cargo;
  assert.strictEqual(reg.validar(reg.limpiar(sin), sin), null);
});

prueba('un nombre sin apellido se rechaza', () => {
  const d = Object.assign({}, bueno, { nombre: 'Ana' });
  const e = reg.validar(reg.limpiar(d), d);
  assert.ok(e && e.nombre, 'debía quejarse del nombre');
});

prueba('falta el organismo', () => {
  const d = Object.assign({}, bueno, { organismo: '' });
  const e = reg.validar(reg.limpiar(d), d);
  assert.ok(e && e.organismo);
});

prueba('falta el tipo', () => {
  const d = Object.assign({}, bueno, { tipo: '' });
  const e = reg.validar(reg.limpiar(d), d);
  assert.ok(e && e.tipo);
});

prueba('el mensaje del correo cambia si venía escrito pero mal', () => {
  const vacio = Object.assign({}, bueno, { email: '' });
  const malo = Object.assign({}, bueno, { email: 'ana@@lucerna' });
  const e1 = reg.validar(reg.limpiar(vacio), vacio);
  const e2 = reg.validar(reg.limpiar(malo), malo);
  assert.ok(/Necesitamos/.test(e1.email), 'vacío: ' + e1.email);
  assert.ok(/no se ve bien/.test(e2.email), 'mal escrito: ' + e2.email);
});

prueba('en la mesa el correo y el teléfono dejan de ser obligatorios', () => {
  const d = { nombre: 'Luis Ramos', organismo: 'CANACO', tipo: 'proveedor' };
  assert.strictEqual(reg.validar(reg.limpiar(d), d, { enMesa: true }), null);
});

prueba('en la mesa un correo mal escrito sigue siendo un error', () => {
  // Dejarlo pasar guardaría basura en la base y rompería la búsqueda por
  // correo justo cuando esa persona quiera recuperar su pase.
  const d = { nombre: 'Luis Ramos', organismo: 'CANACO', tipo: 'general',
              email: 'luis@@canaco' };
  const e = reg.validar(reg.limpiar(d), d, { enMesa: true });
  assert.ok(e && e.email, 'debía quejarse del correo');
});

/* ---------------- Códigos ---------------- */

prueba('el código tiene ocho caracteres del alfabeto', () => {
  for (let i = 0; i < 400; i++) {
    const c = reg.generarCodigo();
    assert.strictEqual(c.length, 8, 'largo de ' + c);
    for (const ch of c) {
      assert.ok(reg.ALFABETO.includes(ch), 'carácter fuera del alfabeto: ' + ch);
    }
  }
});

prueba('el alfabeto no trae caracteres que se confundan al dictar', () => {
  ['O', '0', 'I', '1', 'L'].forEach((c) =>
    assert.ok(!reg.ALFABETO.includes(c), c + ' no debería estar'));
});

prueba('los códigos no se repiten en diez mil tiros', () => {
  const vistos = new Set();
  for (let i = 0; i < 10000; i++) vistos.add(reg.generarCodigo());
  assert.strictEqual(vistos.size, 10000, 'hubo repetidos');
});

prueba('el sorteo de caracteres no favorece a los primeros del alfabeto', () => {
  // `byte % 31` haría un 12 % más probables los primeros ocho caracteres.
  // La prueba lo detectaría: con tanta muestra, un sesgo así se sale de
  // cuatro desviaciones estándar.
  const TIROS = 60000;
  const cuenta = {};
  for (const c of reg.ALFABETO) cuenta[c] = 0;
  for (let i = 0; i < TIROS / 8; i++) {
    for (const ch of reg.generarCodigo()) cuenta[ch]++;
  }

  const n = reg.ALFABETO.length;
  const esperado = TIROS / n;
  const sigma = Math.sqrt(TIROS * (1 / n) * (1 - 1 / n));
  const tope = 4 * sigma;

  for (const c of reg.ALFABETO) {
    const desvio = Math.abs(cuenta[c] - esperado);
    assert.ok(desvio < tope,
      c + ' salió ' + cuenta[c] + ' veces; se esperaban ~' +
      Math.round(esperado) + ' (tope ' + Math.round(tope) + ')');
  }
});

/* ---------------- Lectura de códigos ---------------- */

prueba('limpiarCodigo acepta el código tal cual', () => {
  assert.strictEqual(reg.limpiarCodigo('K7M2Q9X4'), 'K7M2Q9X4');
  assert.strictEqual(reg.limpiarCodigo('k7m2q9x4'), 'K7M2Q9X4');
  assert.strictEqual(reg.limpiarCodigo('  K7M2-Q9X4 '), 'K7M2Q9X4');
});

prueba('limpiarCodigo toma el código del FINAL de una liga', () => {
  // Tomar el primero devolvería un pedazo del dominio.
  assert.strictEqual(
    reg.limpiarCodigo('https://cotuco.quantummkt.host/?c=K7M2Q9X4'),
    'K7M2Q9X4');
});

prueba('limpiarCodigo rechaza lo que no es un código', () => {
  ['', 'ABC', '123', null, undefined, 'K7M2Q9X'] // siete caracteres
    .forEach((v) => assert.strictEqual(reg.limpiarCodigo(v), null, 'con ' + v));
});

prueba('limpiarCodigo rechaza códigos con letras fuera del alfabeto', () => {
  // La O y el 0 no existen en el alfabeto: si llegan, es una mala lectura
  // y vale más decirlo que dejar entrar a quien no corresponde.
  assert.strictEqual(reg.limpiarCodigo('K7M2Q9O4'), null);
  assert.strictEqual(reg.limpiarCodigo('K7M2Q914'), null);
});

/* ---------------- Parámetros de las consultas ---------------- */

/** Base de mentiras: sólo guarda con qué la llamaron. */
function baseEspia() {
  const llamadas = [];
  return {
    llamadas,
    query(texto, args) {
      llamadas.push({ texto, args: args || [] });
      return Promise.resolve({ rows: [{ n: 0 }] });
    },
  };
}

prueba('ningún parámetro lleva un byte nulo', async () => {
  // PostgreSQL no admite el carácter \u0000 dentro de un texto: la
  // consulta entera se cae con «invalid byte sequence for encoding
  // UTF8». Se usaba como centinela para «no hay dígitos que buscar» y
  // tiraba toda búsqueda por nombre.
  const db = baseEspia();
  await reg.buscar(db, 'Peña');
  await reg.listar(db, { q: 'Peña' });
  await reg.buscar(db, '6641234567');

  db.llamadas.forEach((l) => {
    l.args.forEach((a) => {
      assert.ok(!/\u0000/.test(String(a)),
        'parámetro con byte nulo: ' + JSON.stringify(a));
    });
  });
  assert.ok(db.llamadas.length >= 3, 'no se ejecutó ninguna consulta');
});

prueba('la búsqueda corta escapa los comodines de SQL', () => {
  // Sin escapar, buscar «100%» traería el padrón completo.
  const d = baseEspia();
  return reg.buscar(d, '100%').then(() => {
    assert.ok(d.llamadas[0].args[0].includes('\\%'),
      'el porcentaje no se escapó: ' + d.llamadas[0].args[0]);
  });
});

/* ---------------- Etiquetas de tipo ---------------- */

prueba('cada tipo tiene su texto largo y su texto corto', () => {
  reg.TIPOS.forEach((t) => {
    assert.ok(reg.ETIQUETA_TIPO[t], 'falta el texto largo de ' + t);
    assert.ok(reg.ETIQUETA_CORTA[t], 'falta el texto corto de ' + t);
  });
});

prueba('el texto corto cabe en una pastilla y en la etiqueta', () => {
  // Doce caracteres es lo que entra en la pastilla de la etiqueta de
  // 62 mm sin encimarse con el código. Si alguien alarga una de estas
  // dos palabras, la etiqueta se rompe en silencio y nadie lo nota
  // hasta que hay cien gafetes impresos.
  reg.TIPOS.forEach((t) =>
    assert.ok(reg.ETIQUETA_CORTA[t].length <= 12,
      'el texto corto de ' + t + ' mide ' + reg.ETIQUETA_CORTA[t].length +
      ': «' + reg.ETIQUETA_CORTA[t] + '»'));
});

/* ---------------- Cambio de categoría ---------------- */

/**
 * Base de mentiras: devuelve lo que se le diga y apunta lo que le
 * preguntaron. Sirve para comprobar que `cambiarTipo` toca una sola
 * columna, que es justo lo que sostiene el permiso que se le dio al
 * perfil de consulta.
 */
function dbEspia(respuestas) {
  const vistas = [];
  return {
    vistas,
    query(sql, args) {
      vistas.push({ sql, args });
      return Promise.resolve({ rows: respuestas.shift() || [] });
    },
  };
}

prueba('cambiarTipo rechaza una categoría inventada', async () => {
  const db = dbEspia([]);
  const r = await reg.cambiarTipo(db, 1, 'patrocinador');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(db.vistas.length, 0, 'no debe tocar la base siquiera');
});

prueba('cambiarTipo acepta las dos categorías reales', async () => {
  for (const t of reg.TIPOS) {
    const db = dbEspia([[{ id: 1, nombre: 'A', organismo: 'B', tipo: t }]]);
    const r = await reg.cambiarTipo(db, 1, t);
    assert.strictEqual(r.ok, true, 'rechazó ' + t);
  }
});

prueba('cambiarTipo sólo escribe la columna tipo', async () => {
  const db = dbEspia([[{ id: 7, nombre: 'A', organismo: 'B', tipo: 'proveedor' }]]);
  await reg.cambiarTipo(db, 7, 'proveedor');
  const escrituras = db.vistas.filter((v) => /UPDATE/i.test(v.sql));
  assert.strictEqual(escrituras.length, 1, 'debe haber una sola escritura');
  const set = escrituras[0].sql.split(/SET/i)[1].split(/WHERE/i)[0];
  // Si alguien agrega otra columna al SET, este permiso deja de ser
  // seguro para una cuenta de sólo lectura y la prueba tiene que caer.
  assert.ok(!/,/.test(set),
    'el UPDATE toca más de una columna: «' + set.trim() + '»');
  assert.ok(/\btipo\b/.test(set), 'el UPDATE no toca tipo');
  assert.ok(!/cancelado_en|llego_en|nombre|email|telefono/i.test(set),
    'el UPDATE toca campos que no debe: «' + set.trim() + '»');
});

prueba('repetir la misma categoría no es un error', async () => {
  // Primera consulta: el UPDATE no cambió nada. Segunda: la fila existe.
  const db = dbEspia([[], [{ id: 3, nombre: 'A', organismo: 'B', tipo: 'general' }]]);
  const r = await reg.cambiarTipo(db, 3, 'general');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sinCambio, true);
});

prueba('cambiarTipo avisa cuando el asistente no existe', async () => {
  const db = dbEspia([[], []]);
  const r = await reg.cambiarTipo(db, 999, 'general');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no encontrado/i);
});

Promise.all(pendientes).then(function () {
  console.log('\n  ' + hechas + ' pruebas pasaron\n');
});

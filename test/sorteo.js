/**
 * Pruebas del sorteo — COTUCO
 *
 * Sin base de datos: se le pasa una base de mentiras que apunta las
 * consultas y devuelve lo que se le diga. Lo que se comprueba aquí no es
 * que Postgres funcione, sino que las reglas del sorteo estén donde
 * deben: quién entra, quién no, y qué pasa cuando dos personas tocan
 * «Sortear» al mismo tiempo.
 *
 *   node test/sorteo.js
 */

'use strict';

const assert = require('assert');
const s = require('../src/services/sorteo');

let hechas = 0;
const pendientes = [];

function bien(nombre) { hechas++; console.log('  ok   ' + nombre); }
function mal(nombre, e) {
  console.log('  FALLÓ ' + nombre);
  console.log('        ' + e.message);
  process.exitCode = 1;
}

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

/** Base de mentiras: devuelve lo que se le dé y apunta lo que se le pidió. */
function dbEspia(respuestas) {
  const vistas = [];
  return {
    vistas,
    sqlDe(i) { return (vistas[i] || {}).sql || ''; },
    query(sql, args) {
      vistas.push({ sql, args });
      const sig = respuestas.shift();
      if (sig instanceof Error) return Promise.reject(sig);
      return Promise.resolve({ rows: sig || [] });
    },
  };
}

console.log('\n  Sorteo de premios · COTUCO\n');

/* ---------------- Quién entra al sorteo ---------------- */

prueba('exigiendo entrada, sólo participa quien ya pasó por la puerta', () => {
  const c = s.condicionElegible(true);
  assert.match(c, /llego_en IS NOT NULL/,
    'debería filtrar por llegada y no lo hace');
});

prueba('sin exigir entrada, no se filtra por llegada', () => {
  const c = s.condicionElegible(false);
  assert.ok(!/llego_en/.test(c),
    'no debería mencionar llego_en: «' + c.trim() + '»');
});

prueba('un cancelado nunca participa, se exija entrada o no', () => {
  [true, false].forEach((req) => {
    assert.match(s.condicionElegible(req), /cancelado_en IS NULL/,
      'deja participar a un cancelado con requiereEntrada=' + req);
  });
});

prueba('quien ya ganó no vuelve a participar', () => {
  [true, false].forEach((req) => {
    const c = s.condicionElegible(req);
    assert.match(c, /NOT EXISTS/, 'no excluye a los que ya ganaron');
    assert.match(c, /estado = 'ganador'/,
      'no distingue un ganador vigente de uno descartado');
  });
});

prueba('un descartado vuelve a entrar al sorteo', () => {
  // La condición excluye sólo a quien tiene un sorteo en estado
  // 'ganador'. Si excluyera por existir cualquier fila, descartar a
  // alguien lo dejaría fuera para siempre y el premio se quedaría sin
  // poder reasignarse al resto de la sala.
  const c = s.condicionElegible(true);
  assert.ok(!/estado\s*(IN|<>|!=)/.test(c),
    'la exclusión no debería mirar otros estados: «' + c.trim() + '»');
});

/* ---------------- La extracción ---------------- */

prueba('no se sortea un premio que no existe', async () => {
  const db = dbEspia([[]]);
  const r = await s.sortear(db, 99, true, 'Ana');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no existe/i);
});

prueba('no se sortea dos veces el mismo premio', async () => {
  const db = dbEspia([
    [{ id: 1, nombre: 'Cena', patrocinador: null }],  // el premio existe
    [{ x: 1 }],                                        // ya tiene ganador
  ]);
  const r = await s.sortear(db, 1, true, 'Ana');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /ya tiene ganador/i);
});

prueba('el premio se bloquea antes de elegir', async () => {
  const db = dbEspia([
    [{ id: 1, nombre: 'Cena', patrocinador: null }],
    [],
    [{ id: 5, nombre: 'Luis', organismo: 'CDT' }],
    [{ id: 10, creado_en: 'ahora' }],
  ]);
  await s.sortear(db, 1, true, 'Ana');
  // Sin FOR UPDATE, dos extracciones simultáneas leen el mismo estado
  // «sin ganador» y las dos siguen adelante.
  assert.match(db.sqlDe(0), /FOR UPDATE/i,
    'la consulta del premio no bloquea la fila');
});

prueba('se elige al azar y en una sola consulta', async () => {
  const db = dbEspia([
    [{ id: 1, nombre: 'Cena', patrocinador: null }],
    [],
    [{ id: 5, nombre: 'Luis', organismo: 'CDT' }],
    [{ id: 10, creado_en: 'ahora' }],
  ]);
  const r = await s.sortear(db, 1, true, 'Ana');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ganador.nombre, 'Luis');

  const eleccion = db.sqlDe(2);
  assert.match(eleccion, /ORDER BY random\(\)/i, 'no elige al azar');
  assert.match(eleccion, /LIMIT 1/i, 'no limita a uno');
  // Traer la lista entera y elegir en JavaScript abriría una ventana
  // entre quiénes había y a quién se grabó.
  assert.ok(!/SELECT\s+a\.\*/i.test(eleccion),
    'no debería traerse el padrón completo para elegir aquí');
});

prueba('avisa cuando no queda nadie elegible', async () => {
  const db = dbEspia([
    [{ id: 1, nombre: 'Cena', patrocinador: null }],
    [],
    [],   // nadie elegible
  ]);
  const r = await s.sortear(db, 1, true, 'Ana');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no ha entrado nadie|elegible/i);
});

prueba('el mensaje de «nadie elegible» distingue las dos reglas', async () => {
  const conEntrada = dbEspia([[{ id: 1, nombre: 'C' }], [], []]);
  const a = await s.sortear(conEntrada, 1, true, 'Ana');
  const sinEntrada = dbEspia([[{ id: 1, nombre: 'C' }], [], []]);
  const b = await s.sortear(sinEntrada, 1, false, 'Ana');
  assert.notStrictEqual(a.error, b.error,
    'el mismo mensaje para las dos reglas no le dice al operador qué revisar');
});

prueba('dos clics simultáneos no producen dos ganadores', async () => {
  const choque = new Error('duplicate key');
  choque.code = '23505';
  const db = dbEspia([
    [{ id: 1, nombre: 'Cena', patrocinador: null }],
    [],
    [{ id: 5, nombre: 'Luis', organismo: 'CDT' }],
    choque,       // el índice único de la base rechaza el segundo
  ]);
  const r = await s.sortear(db, 1, true, 'Ana');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /al mismo tiempo|vuelve a cargar/i);
});

prueba('un error que no es choque de índice sí se propaga', async () => {
  const feo = new Error('se cayó la base');
  feo.code = '08006';
  const db = dbEspia([
    [{ id: 1, nombre: 'Cena', patrocinador: null }],
    [],
    [{ id: 5, nombre: 'Luis', organismo: 'CDT' }],
    feo,
  ]);
  await assert.rejects(() => s.sortear(db, 1, true, 'Ana'), /se cayó la base/);
});

/* ---------------- Descartes y borrado ---------------- */

prueba('descartar sólo afecta a un ganador vigente', async () => {
  const db = dbEspia([[{ id: 3, premio_id: 1, asistente_id: 5 }]]);
  const r = await s.descartar(db, 3, 'Ana');
  assert.strictEqual(r.ok, true);
  assert.match(db.sqlDe(0), /estado = 'ganador'/,
    'debería exigir que estuviera vigente');
  assert.match(db.sqlDe(0), /SET estado = 'descartado'/,
    'debería marcar, no borrar: el acta se pierde si se borra');
  assert.ok(!/DELETE/i.test(db.sqlDe(0)), 'no debe borrar la fila');
});

prueba('descartar dos veces avisa en vez de fingir que funcionó', async () => {
  const db = dbEspia([[]]);
  const r = await s.descartar(db, 3, 'Ana');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no existe|descartado/i);
});

prueba('no se borra un premio que ya tiene ganador', async () => {
  const db = dbEspia([[{ x: 1 }]]);
  const r = await s.borrarPremio(db, 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /ya tiene ganador/i);
  assert.strictEqual(db.vistas.length, 1, 'ni siquiera debería intentar el DELETE');
});

prueba('un premio sin ganador sí se borra', async () => {
  const db = dbEspia([[], [{ id: 1, nombre: 'Cena' }]]);
  const r = await s.borrarPremio(db, 1);
  assert.strictEqual(r.ok, true);
});

/* ---------------- Premios ---------------- */

prueba('un premio sin nombre se rechaza', async () => {
  const db = dbEspia([]);
  for (const v of ['', '   ', null, undefined]) {
    const r = await s.crearPremio(db, { nombre: v });
    assert.strictEqual(r.ok, false, 'aceptó un nombre vacío: ' + JSON.stringify(v));
  }
  assert.strictEqual(db.vistas.length, 0, 'no debería tocar la base');
});

prueba('un orden que no es número no tumba el alta', async () => {
  const db = dbEspia([[{ id: 1, nombre: 'Cena', patrocinador: null, orden: 0 }]]);
  const r = await s.crearPremio(db, { nombre: 'Cena', orden: 'mañana' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(db.vistas[0].args[2], 0, 'debería caer en 0');
});

/* ---------------- Nada de esto toca el registro ---------------- */

prueba('el sorteo no escribe en asistentes ni en accesos', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'sorteo.js'), 'utf8');
  // Es la promesa que sostiene haber montado esto el día antes del
  // evento: el módulo es aditivo. Si alguien agrega aquí un UPDATE al
  // padrón, deja de serlo y esta prueba tiene que caer.
  for (const m of src.matchAll(/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+(\w+)/gi)) {
    assert.ok(['premios', 'sorteos'].includes(m[2].toLowerCase()),
      'el sorteo escribe en «' + m[2] + '», que no es suyo');
  }
});

Promise.all(pendientes).then(function () {
  console.log('\n  ' + hechas + ' pruebas pasaron\n');
});

/**
 * Revisa las consultas contra el esquema — COTUCO
 *
 * Esta prueba existe por un error real: una consulta trasplantada de otro
 * proyecto llamaba a `unaccent_simple`, que allá existía y aquí no. La
 * búsqueda por empresa fallaba en silencio y nadie se enteró hasta el
 * día del evento.
 *
 * Aquí se lee el SQL de sql/ y todas las consultas de src/, y se revisa:
 *
 *   1. Que cada función propia que se llama esté definida en el esquema.
 *   2. Que cada tabla y vista que se consulta exista.
 *   3. Que cada columna escrita como `alias.columna` exista en su tabla.
 *   4. Que cada clave de config que lee el servidor esté sembrada.
 *
 * No reemplaza probar contra la base, pero atrapa en un segundo lo que
 * sólo se vería con la fila esperando.
 *
 *   node test/consultas.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

let hechas = 0;
function prueba(nombre, fn) {
  try {
    fn();
    hechas++;
    console.log('  ok   ' + nombre);
  } catch (e) {
    console.log('  FALLÓ ' + nombre);
    console.log('        ' + e.message);
    process.exitCode = 1;
  }
}

/* ------------------------------------------------------------------ *
 * Lectura del esquema
 * ------------------------------------------------------------------ */

const sql = fs.readdirSync(path.join(RAIZ, 'sql'))
  .filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(RAIZ, 'sql', f), 'utf8'))
  .join('\n');

/** Funciones definidas en el esquema. */
const funcionesPropias = new Set(
  [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)/gi)]
    .map((m) => m[1].toLowerCase())
);

/** Tablas y sus columnas. */
const tablas = {};
for (const m of sql.matchAll(
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
  const cuerpo = m[2];
  const cols = [];
  for (const linea of cuerpo.split('\n')) {
    const t = linea.trim();
    // Una definición de columna empieza con el nombre; las restricciones
    // de tabla empiezan con una palabra reservada.
    const c = t.match(/^(\w+)\s+[A-Z]/);
    if (!c) continue;
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(c[1])) continue;
    cols.push(c[1].toLowerCase());
  }
  tablas[m[1].toLowerCase()] = cols;
}

/** Vistas definidas. */
const vistas = new Set(
  [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)/gi)]
    .map((m) => m[1].toLowerCase())
);

/** Columnas que entrega cada vista, leídas de su SELECT. */
function columnasDeVista(nombre) {
  const m = sql.match(
    new RegExp('CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+' + nombre +
               '\\s+AS([\\s\\S]*?);', 'i'));
  if (!m) return [];
  const cuerpo = m[1].split(/\bFROM\b/i)[0];
  const cols = [];
  for (const a of cuerpo.matchAll(/\bAS\s+(\w+)/gi)) cols.push(a[1].toLowerCase());
  // Columnas sin alias, del estilo `SELECT a.id, a.nombre`.
  for (const a of cuerpo.matchAll(/\b\w+\.(\w+)\s*(?:,|$)/gm)) {
    cols.push(a[1].toLowerCase());
  }
  return cols;
}

/* ------------------------------------------------------------------ *
 * Lectura de las consultas del servidor
 * ------------------------------------------------------------------ */

function archivosJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivosJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const archivos = archivosJs(path.join(RAIZ, 'src'))
  .concat(archivosJs(path.join(RAIZ, 'scripts')))
  .map((f) => fs.readFileSync(f, 'utf8'));

const fuente = archivos.join('\n');

/**
 * Las consultas van en plantillas con acentos graves.
 *
 * Se parte cada archivo por el acento grave y se toman los pedazos
 * impares: dentro de un archivo los acentos vienen en pares, así que lo
 * impar es lo que está DENTRO de una plantilla. Buscarlas con una
 * expresión regular no funciona —se brinca del cierre de una plantilla a
 * la apertura de la siguiente y se traga el JavaScript de en medio, y
 * entonces cada función del código parece una función de SQL que no
 * existe.
 */
const consultas = [];
for (const src of archivos) {
  const pedazos = src.split('`');
  for (let i = 1; i < pedazos.length; i += 2) {
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(pedazos[i])) {
      consultas.push(pedazos[i]);
    }
  }
}

/**
 * Vacía el contenido de las cadenas, dejando las comillas.
 *
 * Lo que va entre comillas es texto, no código: un CASE que devuelve
 * 'Invitado (Organismos Colegiados…)' hacía que la revisión viera
 * «invitado(» y reclamara una función inexistente. Se vacían en vez de
 * borrarse para no pegar lo de un lado con lo del otro.
 */
function sinCadenas(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

// Se unen con un punto y coma de por medio: con un simple salto de línea,
// una consulta que termina en `DO UPDATE` seguida de otra que empieza en
// `INSERT INTO` se leía como «UPDATE insert», y aparecía una tabla
// llamada `insert` que nadie escribió.
const todoSql = sinCadenas(consultas.join('\n;\n'));

/* ------------------------------------------------------------------ *
 * Las pruebas
 * ------------------------------------------------------------------ */

console.log('\n  Consultas contra el esquema · COTUCO\n');

prueba('el esquema define lo que se espera', () => {
  assert.ok(tablas.asistentes, 'falta la tabla asistentes');
  assert.ok(tablas.usuarios, 'falta la tabla usuarios');
  assert.ok(tablas.accesos, 'falta la tabla accesos');
  assert.ok(tablas.config, 'falta la tabla config');
  assert.ok(funcionesPropias.has('sin_acentos'), 'falta sin_acentos');
  assert.ok(vistas.has('v_resumen'), 'falta la vista v_resumen');
});

prueba('se encontraron consultas que revisar', () => {
  assert.ok(consultas.length > 15,
    'sólo se detectaron ' + consultas.length + ' consultas; ' +
    'el extractor dejó de reconocerlas');
});

// Funciones que trae PostgreSQL. Lo que no esté aquí ni en el esquema es
// una función inventada, que es justo el error que esta prueba busca.
const DE_POSTGRES = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'greatest',
  'least', 'lower', 'upper', 'btrim', 'trim', 'ltrim', 'rtrim', 'length',
  'substring', 'replace', 'translate', 'to_char', 'to_date', 'now',
  'clock_timestamp', 'date_trunc', 'extract', 'age', 'md5', 'encode',
  'decode', 'random', 'concat', 'array_agg', 'string_agg', 'json_agg',
  'row_number', 'rank', 'left', 'right', 'position', 'split_part',
  'regexp_replace', 'cast', 'abs', 'round', 'ceil', 'floor', 'filter',
  'values', 'coalese',
]);

prueba('no se llama a ninguna función que no exista', () => {
  const sospechosas = new Set();
  for (const m of todoSql.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const f = m[1].toLowerCase();
    if (DE_POSTGRES.has(f)) continue;
    if (funcionesPropias.has(f)) continue;
    // `INSERT INTO usuarios (email, …)` deja el nombre de la tabla
    // pegado a un paréntesis; no es una llamada a función.
    if (tablas[f] || vistas.has(f)) continue;
    // Palabras reservadas que van seguidas de paréntesis.
    if (/^(select|insert|update|delete|from|where|on|and|or|not|in|values|set|returning|interval|int|text|timestamptz|boolean|exists|case|when|then|else|end|order|by|group|limit|offset|conflict|do|nothing|returning|as|is|null|distinct|union|all|using|with|over|partition|for|key|primary|foreign|unique|check|constraint|default|references|cascade|serial|char|varchar|numeric|decimal|real|float|bigint|smallint|date|time|timestamp|boolean)$/
        .test(f)) continue;
    sospechosas.add(f);
  }
  assert.strictEqual(sospechosas.size, 0,
    'funciones no definidas: ' + [...sospechosas].join(', '));
});

prueba('todas las tablas y vistas que se consultan existen', () => {
  const conocidas = new Set(Object.keys(tablas).concat([...vistas]));
  // `session` la crea connect-pg-simple sola, no está en el esquema.
  conocidas.add('session');

  // `DO UPDATE SET` y `SAVEPOINT` quedan atrapados por el patrón sin ser
  // nombres de tabla: son palabras que siguen a UPDATE o a INTO.
  const NO_SON_TABLAS = /^(set|savepoint|values|select)$/;

  const faltan = new Set();
  for (const m of todoSql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) {
    const t = m[1].toLowerCase();
    if (NO_SON_TABLAS.test(t)) continue;
    if (!conocidas.has(t)) faltan.add(t);
  }
  assert.strictEqual(faltan.size, 0,
    'tablas o vistas que no existen: ' + [...faltan].join(', '));
});

prueba('todas las columnas con alias existen en su tabla', () => {
  const malas = new Set();

  for (const cruda of consultas) {
    // Sin el texto de las cadenas: un literal como 'Col. Aviación' tiene
    // un punto y se leería como la columna `col.aviación`.
    const q = sinCadenas(cruda);

    // Qué alias apunta a qué tabla dentro de esta consulta.
    const alias = {};
    for (const m of q.matchAll(/\b(?:FROM|JOIN|UPDATE)\s+(\w+)\s+(?:AS\s+)?(\w+)\b/gi)) {
      const tabla = m[1].toLowerCase();
      const a = m[2].toLowerCase();
      // `FROM asistentes WHERE` no define alias: WHERE es palabra clave.
      if (/^(where|set|on|using|order|group|limit|values|returning|left|right|inner|full|join|as)$/
          .test(a)) continue;
      alias[a] = tabla;
    }
    // Sin alias, el nombre de la tabla vale como prefijo.
    for (const m of q.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(\w+)/gi)) {
      alias[m[1].toLowerCase()] = m[1].toLowerCase();
    }

    for (const m of q.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const a = m[1].toLowerCase();
      const col = m[2].toLowerCase();
      const tabla = alias[a];
      if (!tabla) continue;

      const cols = tablas[tabla] ||
                   (vistas.has(tabla) ? columnasDeVista(tabla) : null);
      if (!cols || !cols.length) continue;
      if (!cols.includes(col)) malas.add(tabla + '.' + col);
    }
  }

  assert.strictEqual(malas.size, 0,
    'columnas que no existen: ' + [...malas].join(', '));
});

prueba('toda clave de config que se lee está sembrada', () => {
  const sembradas = new Set();
  const bloque = sql.match(/INSERT INTO config[\s\S]*?ON CONFLICT/i);
  if (bloque) {
    for (const m of bloque[0].matchAll(/\('([a-z_]+)'\s*,/gi)) {
      sembradas.add(m[1]);
    }
  }

  // Las que el servidor nombra explícitamente.
  const usadas = new Set();
  for (const m of fuente.matchAll(/clave\s*=\s*'([a-z_]+)'/gi)) usadas.add(m[1]);
  for (const m of fuente.matchAll(/\bc(?:fg)?\.([a-z_]+)\b/g)) {
    // Sólo las que también aparecen sembradas tienen sentido comparar:
    // `c.` se usa para muchas cosas en el código.
    if (sembradas.has(m[1])) usadas.add(m[1]);
  }

  const faltan = [...usadas].filter((k) => !sembradas.has(k));
  assert.strictEqual(faltan.length, 0,
    'claves de config sin sembrar: ' + faltan.join(', '));
});

prueba('la lista de claves que el panel guarda existe en el esquema', () => {
  const m = fuente.match(/const CLAVES = \[([\s\S]*?)\];/);
  assert.ok(m, 'no se encontró la lista CLAVES del servidor');

  const sembradas = new Set();
  const bloque = sql.match(/INSERT INTO config[\s\S]*?ON CONFLICT/i);
  for (const s of bloque[0].matchAll(/\('([a-z_]+)'\s*,/gi)) sembradas.add(s[1]);

  const claves = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  const faltan = claves.filter((k) => !sembradas.has(k));
  assert.strictEqual(faltan.length, 0,
    'el panel guarda claves que no existen: ' + faltan.join(', '));
});

prueba('el CHECK de tipo cubre exactamente los tipos del código', () => {
  const m = sql.match(/tipo\s+TEXT[\s\S]*?CHECK\s*\(tipo IN \(([^)]*)\)\)/i);
  assert.ok(m, 'no se encontró el CHECK de tipo');
  const enSql = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();

  const reg = require('../src/services/registros');
  assert.deepStrictEqual(enSql, [...reg.TIPOS].sort(),
    'el esquema permite ' + enSql.join(', ') +
    ' y el código usa ' + reg.TIPOS.join(', '));
});

prueba('todo CHECK de rol cubre exactamente los roles del middleware', () => {
  // Hay más de uno: el de la columna en 001 —el que se aplica en una
  // base nueva— y el que lo reemplaza en 002 —el que se aplica en la
  // base que ya está desplegada—. Si se actualiza uno y se olvida el
  // otro, el despliegue nuevo y el viejo aceptan perfiles distintos y
  // el error aparece hasta que alguien intenta crear la cuenta.
  const listas = [...sql.matchAll(/CHECK\s*\(\s*rol IN \(([^)]*)\)\s*\)/gi)]
    .map((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort());

  assert.ok(listas.length >= 1, 'no se encontró ningún CHECK de rol');

  const auth = require('../src/middleware/auth');
  const esperado = [...auth.ROLES].sort();
  listas.forEach((enSql, i) =>
    assert.deepStrictEqual(enSql, esperado,
      'el CHECK #' + (i + 1) + ' permite ' + enSql.join(', ') +
      ' y el middleware usa ' + auth.ROLES.join(', ')));
});

prueba('el padrón se lee con `consulta` y se cambia con `admin`', () => {
  // El perfil de cliente tiene que poder mirar sin poder tocar. Si
  // alguien marca por descuido una ruta de escritura con el permiso de
  // lectura, COTUCO podría cancelar un registro o cerrar el formulario
  // desde su propia cuenta.
  const servidor = fs.readFileSync(
    path.join(RAIZ, 'src', 'server.js'), 'utf8');

  const LECTURA = ['/api/panel/resumen', '/api/asistentes', '/api/asistentes.csv'];
  const ESCRITURA = ['/api/asistentes/:id/cancelar', '/api/asistentes/:id/reactivar',
                     '/api/config', '/api/usuarios'];

  for (const ruta of LECTURA) {
    const re = new RegExp("app\\.get\\('" + ruta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                          "',\\s*auth\\.exige\\('(\\w+)'\\)");
    const m = servidor.match(re);
    assert.ok(m, 'no se encontró la ruta de lectura ' + ruta);
    assert.strictEqual(m[1], 'consulta',
      ruta + ' exige ' + m[1] + ' y debería exigir consulta');
  }

  for (const ruta of ESCRITURA) {
    const re = new RegExp("app\\.post\\('" + ruta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                          "',\\s*\\n?\\s*auth\\.exige\\('(\\w+)'\\)");
    const m = servidor.match(re);
    assert.ok(m, 'no se encontró la ruta de escritura ' + ruta);
    assert.strictEqual(m[1], 'admin',
      ruta + ' exige ' + m[1] + ' y debería exigir admin');
  }
});

prueba('`consulta` no alcanza nada que cambie datos', () => {
  const auth = require('../src/middleware/auth');
  ['admin', 'mesa', 'puerta'].forEach((p) =>
    assert.ok(!auth.puede('consulta', p),
      'consulta no debería tener el permiso ' + p));
  assert.ok(auth.puede('consulta', 'consulta'));
  // Y el administrador sigue viéndolo todo.
  assert.ok(auth.puede('admin', 'consulta'), 'admin perdió el acceso de lectura');
});

prueba('cada rol del middleware tiene permisos definidos', () => {
  const auth = require('../src/middleware/auth');
  auth.ROLES.forEach((r) =>
    assert.ok(Array.isArray(auth.PERMISOS[r]) && auth.PERMISOS[r].length,
      'el rol ' + r + ' no tiene permisos'));
  // Admin tiene que poder entrar a todo: si no, el panel se queda sin
  // dueño y hay que arreglarlo con la base en la mano.
  ['admin', 'mesa', 'puerta'].forEach((p) =>
    assert.ok(auth.puede('admin', p), 'admin no puede ' + p));
  assert.ok(!auth.puede('puerta', 'admin'), 'puerta no debería ser admin');
  assert.ok(!auth.puede('mesa', 'admin'), 'mesa no debería ser admin');
});

prueba('el CHECK de resultado de accesos cubre lo que inserta el código', () => {
  const m = sql.match(/resultado\s+TEXT[\s\S]*?CHECK\s*\(resultado IN \(([^)]*)\)\)/i);
  assert.ok(m, 'no se encontró el CHECK de resultado');
  const permitidos = new Set([...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));

  const insertados = new Set();
  for (const q of consultas) {
    for (const i of q.matchAll(/INSERT INTO accesos[\s\S]*?'(\w+)'/gi)) {
      insertados.add(i[1]);
    }
  }
  const fuera = [...insertados].filter((r) => !permitidos.has(r));
  assert.strictEqual(fuera.length, 0,
    'el código inserta resultados no permitidos: ' + fuera.join(', '));
});

console.log('\n  ' + hechas + ' pruebas pasaron\n');

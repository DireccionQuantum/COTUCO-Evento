-- =====================================================================
-- Registro de asistentes · COTUCO
-- Comité de Turismo y Convenciones de Tijuana
--
-- Registro individual: una persona, una fila, un código, un QR.
-- No hay acompañantes — quien asiste se registra por su cuenta.
--
-- Dos tipos de asistente, que es lo único que los distingue en la
-- operación: el invitado general y el proveedor de la cadena de valor.
-- En la puerta y en la etiqueta se ven distintos para que el personal
-- sepa a quién tiene enfrente sin preguntar.
--
-- Idempotente: se puede correr las veces que haga falta.
-- =====================================================================

-- Para quitar acentos al buscar: «Peña» se encuentra escribiendo «pena».
-- Se hace con translate y no con la extensión unaccent porque ésta
-- requiere permisos de superusuario que un hosting administrado no da.
CREATE OR REPLACE FUNCTION sin_acentos(t TEXT) RETURNS TEXT AS $$
  SELECT lower(translate(COALESCE(t, ''),
    'áàäâãéèëêíìïîóòöôõúùüûñÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ',
    'aaaaaeeeeiiiiooooouuuunAAAAAEEEEIIIIOOOOOUUUUN'));
$$ LANGUAGE SQL IMMUTABLE;


-- ---------- Ajustes del evento ----------
-- Todo lo que cambia de un evento a otro vive aquí, no en el código.
-- Así el mismo despliegue sirve para el siguiente evento de COTUCO
-- cambiando seis renglones desde el panel.
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT INTO config (clave, valor) VALUES
  -- Nombre completo: es el que va en el calendario, en el título de la
  -- pestaña y en la imagen del pase.
  ('evento',       'Cóctel Presentación · Tijuana, un destino para congresos y convenciones'),
  -- La línea corta que se lee bajo el logotipo del evento. Aparte del
  -- nombre completo porque ahí sólo caben unas palabras.
  ('lema',         'Un destino para congresos y convenciones'),
  ('sede',         'Grand Salón · Grand Hotel Tijuana'),
  ('direccion',    'Blvd. Agua Caliente 4558, Col. Aviación, Tijuana, B.C.'),
  ('fecha',        '2026-10-21'),  -- AAAA-MM-DD
  ('hora',         '19:00'),       -- HH:MM en 24 h
  ('registros_abiertos', 'si'),
  -- Tope de asistentes. Vacío = sin tope.
  ('cupo',         ''),
  -- Si la puerta imprime etiqueta además de registrar el ingreso.
  ('etiqueta_en_puerta', 'no')
ON CONFLICT (clave) DO NOTHING;


-- ---------- Quien opera el evento ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'puerta'
                  CHECK (rol IN ('admin', 'mesa', 'puerta')),
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- Los asistentes ----------
CREATE TABLE IF NOT EXISTS asistentes (
  id        SERIAL PRIMARY KEY,

  -- Nombre completo en un solo campo: es lo que se pidió en el
  -- formulario y es lo que se imprime en la etiqueta.
  nombre    TEXT NOT NULL,
  cargo     TEXT,
  organismo TEXT NOT NULL,
  telefono  TEXT,
  email     TEXT,

  -- 'general'   = invitado general
  -- 'proveedor' = cadena de valor / proveedor
  tipo      TEXT NOT NULL DEFAULT 'general'
              CHECK (tipo IN ('general', 'proveedor')),

  -- El código del QR. Ocho caracteres de un alfabeto sin letras que se
  -- confundan: nada de O/0 ni I/1/L, porque alguien va a dictarlo por
  -- teléfono o teclearlo a mano en la mesa.
  codigo    TEXT UNIQUE NOT NULL,

  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  origen    TEXT NOT NULL DEFAULT 'linea'
              CHECK (origen IN ('linea', 'mesa')),

  -- Llegada al evento. Null = no ha llegado.
  llego_en  TIMESTAMPTZ,
  llego_por TEXT,

  -- Cuándo se le imprimió su etiqueta y cuántas veces. La cuenta sirve
  -- para detectar reimpresiones y para calcular rollo al cierre.
  impreso_en   TIMESTAMPTZ,
  impresiones  INT NOT NULL DEFAULT 0,

  -- Para dar de baja sin borrar: queda el registro de que se inscribió
  -- y luego canceló, que es dato útil para el corte final.
  cancelado_en TIMESTAMPTZ,

  nota      TEXT
);

CREATE INDEX IF NOT EXISTS ix_asi_codigo   ON asistentes(codigo);
CREATE INDEX IF NOT EXISTS ix_asi_tipo     ON asistentes(tipo);
CREATE INDEX IF NOT EXISTS ix_asi_llegada  ON asistentes(llego_en)
  WHERE llego_en IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_asi_registro ON asistentes(registrado_en);

-- Nadie debería registrarse dos veces con el mismo correo. Es un índice
-- parcial y no una restricción dura porque en la mesa el correo puede
-- quedar vacío: a nadie se le niega el acceso por no traer correo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asi_email
  ON asistentes (lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '' AND cancelado_en IS NULL;


-- ---------- Bitácora de accesos ----------
-- Se guarda cada escaneo, no sólo el primero: si alguien sale a una
-- llamada y vuelve, queda el registro y se puede reconstruir qué pasó.
CREATE TABLE IF NOT EXISTS accesos (
  id           SERIAL PRIMARY KEY,
  asistente_id INT NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  momento      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resultado    TEXT NOT NULL
                 CHECK (resultado IN ('entrada', 'repetido', 'cancelado')),
  por          TEXT
);

CREATE INDEX IF NOT EXISTS ix_acc_asistente ON accesos(asistente_id);
CREATE INDEX IF NOT EXISTS ix_acc_momento   ON accesos(momento);


-- ---------- Cómo va el evento ----------
DROP VIEW IF EXISTS v_resumen;
CREATE VIEW v_resumen AS
SELECT
  count(*) FILTER (WHERE cancelado_en IS NULL)::int
    AS registrados,
  count(*) FILTER (WHERE tipo = 'general'   AND cancelado_en IS NULL)::int
    AS generales,
  count(*) FILTER (WHERE tipo = 'proveedor' AND cancelado_en IS NULL)::int
    AS proveedores,
  count(*) FILTER (WHERE llego_en IS NOT NULL AND cancelado_en IS NULL)::int
    AS llegaron,
  count(*) FILTER (WHERE impreso_en IS NOT NULL AND cancelado_en IS NULL)::int
    AS impresas,
  count(*) FILTER (WHERE origen = 'mesa' AND cancelado_en IS NULL)::int
    AS en_mesa,
  count(*) FILTER (WHERE cancelado_en IS NOT NULL)::int
    AS cancelados,
  count(*) FILTER (WHERE cancelado_en IS NULL
                     AND registrado_en > now() - interval '24 hours')::int
    AS hoy
FROM asistentes;


-- Quién está adentro, para la pantalla de la puerta.
DROP VIEW IF EXISTS v_adentro;
CREATE VIEW v_adentro AS
SELECT a.id, a.nombre, a.organismo, a.tipo, a.llego_en
  FROM asistentes a
 WHERE a.llego_en IS NOT NULL AND a.cancelado_en IS NULL;

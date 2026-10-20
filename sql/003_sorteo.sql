-- =====================================================================
-- Sorteo de premios · COTUCO
--
-- Va en una migración aparte y no dentro de 001 porque el esquema base
-- ya está aplicado en producción: tocarlo ahí no haría nada. Todo lo de
-- aquí es aditivo —dos tablas nuevas y una clave de configuración— y
-- nada de esto toca `asistentes`, `accesos` ni el flujo de registro.
-- Si el sorteo no se usa, el resto del sistema no se entera.
-- =====================================================================

-- ---------- Los premios ----------
CREATE TABLE IF NOT EXISTS premios (
  id     SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,

  -- Quién lo da. Opcional, pero es lo que se proyecta debajo del premio
  -- y es media razón por la que un patrocinador pone el premio.
  patrocinador TEXT,

  -- El orden en que se sortean. Se captura a mano porque el maestro de
  -- ceremonias decide el orden, no la base.
  orden  INT NOT NULL DEFAULT 0,

  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS premios_orden ON premios (orden, id);

-- ---------- Los sorteos realizados ----------
--
-- Una fila por extracción, no una columna `ganador_id` en el premio.
-- La diferencia importa: si el ganador no está en el salón hay que
-- volver a sortear, y con una sola columna se perdería el rastro de a
-- quién había salido antes. Aquí el descarte queda escrito y el acta se
-- puede reconstruir tal como ocurrió.
CREATE TABLE IF NOT EXISTS sorteos (
  id SERIAL PRIMARY KEY,

  premio_id    INT NOT NULL REFERENCES premios (id) ON DELETE CASCADE,
  asistente_id INT NOT NULL REFERENCES asistentes (id) ON DELETE CASCADE,

  -- 'ganador'    = extracción vigente
  -- 'descartado' = salió pero no estaba, o no se presentó a recoger
  estado TEXT NOT NULL DEFAULT 'ganador'
           CHECK (estado IN ('ganador', 'descartado')),

  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  por       TEXT
);

CREATE INDEX IF NOT EXISTS sorteos_premio ON sorteos (premio_id, creado_en DESC);

-- Un premio no puede tener dos ganadores vigentes a la vez. El índice
-- parcial lo impide en la base y no sólo en el código: dos personas
-- tocando «Sortear» al mismo tiempo es exactamente el escenario del día
-- del evento, y ahí no hay quien revise.
CREATE UNIQUE INDEX IF NOT EXISTS sorteos_un_ganador_por_premio
  ON sorteos (premio_id) WHERE estado = 'ganador';

-- Nadie gana dos veces. Misma lógica: se hace cumplir en la base.
CREATE UNIQUE INDEX IF NOT EXISTS sorteos_un_premio_por_persona
  ON sorteos (asistente_id) WHERE estado = 'ganador';

-- ---------- Configuración ----------
INSERT INTO config (clave, valor) VALUES
  -- 'si' = sólo entra al sorteo quien ya pasó por la puerta.
  -- 'no' = entra todo el padrón, haya llegado o no.
  --
  -- Se deja en 'si' porque es lo que sostiene la mecánica: la gente se
  -- queda al sorteo si sabe que hay que estar para ganar. Cambiarlo es
  -- una decisión del organizador, no del programa, y por eso vive en la
  -- configuración y no escondido en una consulta.
  ('sorteo_requiere_entrada', 'si')
ON CONFLICT (clave) DO NOTHING;

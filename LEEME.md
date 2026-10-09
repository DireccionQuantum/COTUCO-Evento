# Registro de asistentes · COTUCO

**Cóctel Presentación — «Tijuana, un destino para congresos y convenciones»**
Miércoles 21 de octubre de 2026 · 19:00 h
Grand Salón, Grand Hotel Tijuana · Blvd. Agua Caliente 4558, Col. Aviación

Plataforma de registro con QR individual, control de acceso en la puerta
e impresión de etiquetas Brother QL para los carnets.

Misma arquitectura que la cena del Día del Médico y que Expo Construcción
CMIC: Node + Express + PostgreSQL, sin dependencias de pago y sin
servicios externos. Se despliega en Railway y queda listo con dos
comandos.

---

## Qué hace

**Para quien asiste** — abre el enlace, llena cinco campos y recibe su
código QR. Puede guardarlo como imagen en su teléfono, agregarlo a su
calendario, o volver al enlace y recuperarlo con su correo.

**En la puerta** — se escanea el QR con cámara o con el lector USB. La
pantalla dice en grande quién llegó, de qué organismo y si es invitado
general o proveedor. Suena distinto según el resultado, porque el
personal no mira la pantalla cuando llega gente en grupo.

**En el carnet** — al escanear, opcionalmente se imprime la etiqueta de
62 × 42 mm en la Brother QL. Es la misma medida que se usó en CMIC y
entra en los portagafetes que ya existen.

**En la mesa** — quien llegue sin registrarse se da de alta en sitio, con
el correo como opcional, y su etiqueta sale al momento. También se busca
a cualquiera por nombre, empresa, teléfono o código para reimprimirle.

**En el panel** — cuántos van, de qué tipo, cuántos llegaron, la lista
completa con filtros, exportación a Excel y los datos del evento.

---

## Pantallas

| Dirección  | Para quién | Qué hace |
|------------|-----------|----------|
| `/`        | Público   | Registro y pase con QR. Es el enlace que se manda por WhatsApp. |
| `/puerta`  | Personal  | Lector de accesos, con impresión opcional de etiqueta. |
| `/mesa`    | Personal  | Alta en sitio, búsqueda y reimpresión de etiquetas. |
| `/etiqueta`| Personal  | Una etiqueta para la Brother QL. Se abre sola desde puerta y mesa. |
| `/panel`   | Admin     | Cifras, padrón, ajustes del evento y cuentas del equipo. |

---

## Perfiles

| Perfil     | Puede |
|------------|-------|
| `admin`    | Todo: padrón completo, cancelar, exportar, configurar, crear cuentas. |
| `mesa`     | Registrar en sitio, buscar, imprimir etiquetas y escanear. |
| `puerta`   | Sólo escanear e imprimir la etiqueta de quien escanea. |
| `consulta` | Mirar: resumen, padrón y exportación. No cambia nada. |

`puerta` es el más restringido a propósito: esas cuentas van en los
teléfonos de personal contratado para el día, y un teléfono se pierde.

`consulta` es el perfil del cliente. COTUCO quiere ir viendo cómo avanzan
los registros, y para eso no hace falta poder cancelar a nadie ni cerrar
el formulario público. Al entrar con ese perfil el panel se abre con dos
pestañas —Resumen y Registrados—, sin los botones de cancelar ni los de
etiqueta, y con una marca de «solo consulta» junto al nombre.

---

## Despliegue en Railway

1. Sube este repositorio a GitHub y conéctalo a un proyecto nuevo.
2. Agrega el complemento **PostgreSQL**. Railway llena `DATABASE_URL`
   solo.
3. Pon estas variables en el servicio:

   ```
   SESSION_SECRET=<una cadena larga al azar>
   NODE_ENV=production
   ```

4. En la consola del servicio:

   ```bash
   npm run migrate
   npm run usuario direccion@quantummkt.mx "Gabriel Torres" admin "tu-contraseña"
   ```

   La contraseña **entre comillas**: lleva caracteres que la terminal se
   come si van sueltos.

5. Asigna el dominio, como en `ampi` y en `cmic`:
   `cotuco.quantummkt.host`.

6. Los datos del evento ya vienen cargados en la migración. Si algo
   cambia —la hora, la sede—, se corrige en `/panel` → pestaña **Evento**
   sin tocar código ni volver a desplegar.

---

## La imagen de marca

La paleta y los logotipos están **muestreados de la invitación**, no
inventados: el azul del panel (`#0D0052`), el oro del logotipo
(`#DFA92C` con brillo en `#F6EEA3`), y los escudos de COTUCO, CDT y FIDEM
recortados de la pieza. Quien abre el enlace acaba de ver esa imagen en
su WhatsApp y tiene que reconocer que es lo mismo.

Las imágenes están en `public/img/`:

| Archivo | Qué es | Dónde se usa |
|---------|--------|--------------|
| `cotuco-blanco.png` | Escudo COTUCO en blanco | Todas las pantallas y el pase |
| `tijuana.png` | El logotipo dorado del evento | Encabezado público y el pase |
| `cdt.png`, `fidem.png` | Los dos aliados | Encabezado público |
| `quantum.png` | Quantum en claro | Pie de las pantallas y del pase |
| `quantum-negro.png` | Quantum en negro | Pie de la etiqueta térmica |

**Para el siguiente evento de COTUCO** basta cambiar `tijuana.png` por el
logotipo que toque y las dos líneas de «Te invita a: / Cóctel
presentación» en `public/index.html`. Todo lo demás —nombre, lema, sede,
fecha, hora— se captura desde el panel.

---

## Impresión de etiquetas

La etiqueta mide **62 × 42 mm** sobre rollo continuo DK-2205.

Al imprimir por primera vez en cada computadora:

- Impresora: la **Brother QL**
- Papel: **62 mm** (rollo continuo)
- Márgenes: **ninguno**
- Escala: **100 %**
- «Ajustar al área imprimible»: **apagado**

El contenido está calculado para los 58 mm que alcanza el cabezal; si el
navegador reescala, los costados se recortan.

Para que la ventana de la etiqueta se abra sola al escanear hay que
**permitir ventanas emergentes** del sitio en ese navegador. Si quieres
que además imprima sin preguntar, abre Chrome con `--kiosk-printing`.

Dónde se enciende la impresión:

- En `/puerta`, con el interruptor «Imprimir etiqueta al escanear». Lo
  que elija quien opera manda sobre lo que diga el panel, porque es quien
  sabe si la impresora está conectada.
- En `/mesa`, con la casilla del formulario.
- En `/panel` → Evento, como valor por omisión del día.

---

## Comandos

```bash
npm start                 # arranca el servidor
npm run migrate           # aplica sql/ en orden (idempotente)
npm run usuario <correo> <nombre> <perfil> <clave>
npm test                  # pruebas, sin base de datos
```

Las pruebas corren en segundos y no tocan PostgreSQL. `test/consultas.js`
lee el esquema y las consultas del servidor y avisa si alguna llama a una
función que no existe, consulta una tabla que no está o usa una columna
mal escrita. Esa prueba existe porque en CMIC una consulta trasplantada
llamaba a `unaccent_simple`, la búsqueda por empresa fallaba en silencio,
y nos enteramos el día del evento.

---

## Decisiones que conviene conocer

**Un correo, un registro.** Quien abre el enlace dos veces recibe su pase
existente, no uno nuevo. En la mesa el correo es opcional: nadie se queda
afuera por no acordarse de su correo con la fila detrás.

**Repetido en la puerta avisa, no bloquea.** La gente sale a contestar
una llamada y vuelve. Queda el registro de cada escaneo en la bitácora,
así que después se puede reconstruir qué pasó.

**Se cuentan las reimpresiones.** Una reimpresión dice que la primera
salió mal, que alguien perdió el carnet, o que se está imprimiendo de
más. Al cierre también sirve para saber cuánto rollo se gastó.

**Códigos sin letras que se confundan.** El alfabeto no trae O, 0, I, 1
ni L. Alguien va a dictar su código por teléfono.

**Cancelar no borra.** Queda el rastro de que se registró y luego
canceló, que es dato útil para el corte final. Y se puede reactivar.

**Los datos del evento viven en la base, no en el código.** El mismo
despliegue sirve para el siguiente evento de COTUCO cambiando seis
renglones desde el panel.

---

Powered by Quantum Marketing & Advertising

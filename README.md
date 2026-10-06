# Veterans 1ª Divisió — app móvil (PWA)

App instalable en el móvil (Android e iOS) con los datos de la **Lliga de 1ª Divisió** de
Veterans Vallès-Maresme, leídos de https://www.veteransfutbol.com.

**Incluye:** clasificación · calendario y resultados por jornada · rankings (goleadores, porteros,
equipos, tarjetas, fair play, MVP, MVT) · equipos · comité de competición.
Pulsando en cualquier equipo (en la clasificación, en las jornadas o en la lista de equipos) se abre
su ficha con la posición, los **próximos partidos** y los resultados ya jugados.
Funciona sin conexión con los últimos datos vistos.

## Cómo funciona

```
Móvil (PWA)  ──►  Tu servidor (Node)  ──►  veteransfutbol.com
   HTML/JS         lee y limpia las          (sin API, sólo HTML)
                   páginas + caché 10 min
```

La web de la liga no tiene API y no permite que una página en el navegador la lea directamente
(CORS), por eso hace falta el pequeño servidor intermedio (`server.js`). Entra una vez en la
1ª división para que la web guarde el campeonato en la sesión y después pide clasificación,
calendario, rankings, etc. Guarda los resultados 10 minutos, así que la web de la liga recibe
muy pocas peticiones aunque uses la app mucho.

## 1. Probar en tu ordenador

Necesitas Node 20 o superior.

```bash
npm install
npm run check   # ← IMPORTANTE: comprueba contra la web real que se extraen los datos
npm start       # http://localhost:3000
```

`npm run check` descarga las páginas reales, muestra cuántos equipos, jornadas, partidos y filas de
ranking encuentra (esperado: 18 equipos, 17 jornadas, 153 partidos) y guarda el HTML en `debug/`.

> **Aviso:** los extractores (`lib/parsers.js`) se escribieron a partir de la estructura que se
> ve en la página de situación, sin poder descargar el HTML real durante el desarrollo. Los tests
> (`npm test`) usan HTML reconstruido. Si `npm run check` marca algo con ✘, los ficheros de
> `debug/` permiten ajustar el parser en minutos.

## 2. Verla en el móvil

- **En casa (misma wifi):** arranca el servidor y abre `http://IP-DE-TU-PC:3000` en el móvil.
- **Para usarla en cualquier sitio:** despliega el servidor en un hosting con HTTPS
  (Render, Railway, Fly.io, un VPS…). Es una app Node sin base de datos: `npm install && npm start`.
  Variable opcional: `PORT`.
- **Instalar:** en Chrome (Android) → menú ⋮ → *Instalar aplicación*. En Safari (iPhone) →
  Compartir → *Añadir a pantalla de inicio*. (Requiere HTTPS salvo en localhost.)

## Subirla a internet para compartirla (Render, gratis)

1. Crea una cuenta en https://github.com y un repositorio nuevo (privado o público). Sube el contenido de
   esta carpeta (sin `node_modules`; el `.gitignore` ya lo excluye).
2. Crea una cuenta en https://render.com y entra con tu usuario de GitHub.
3. *New +* → **Blueprint** → elige tu repositorio. Render lee `render.yaml` y lo configura solo.
4. Espera 2-3 minutos. Te dará una dirección tipo `https://veterans-1a-divisio.onrender.com`:
   esa es la que compartes. Se puede instalar en el móvil desde el navegador.

Notas: en el plan gratuito, si nadie la usa durante ~15 minutos se "duerme" y la primera visita
tarda ~1 minuto en cargar. Railway, Fly.io o un VPS también sirven (comando de arranque: `npm start`).

## Si faltan partidos en las fichas de equipo

Ejecuta `npm run diagnose`: escribe `debug/diagnose.txt` con un resumen de cómo entrega la liga el
calendario (desplegables de jornada, botones, enlaces). Con ese texto se ajusta el extractor para leer
todas las jornadas.

## De dónde salen los datos de jugadores

Cada equipo tiene su ficha (`team.aspx`) con la **plantilla**: goles (G), goles en propia puerta (GPP), goles
recibidos (GR) y tarjetas amarillas y rojas de cada jugador, además del cuerpo técnico y los recuadros laterales
con los próximos y últimos partidos. La app lee esas fichas y con ellas:

- muestra la plantilla de cada equipo (con sus goles y tarjetas) al abrir un equipo;
- calcula los rankings de **goleadores**, **tarjetas** y **porteros** (goles recibidos) sumando los 18 equipos;
- completa los **próximos partidos** y el **último resultado** de cada equipo con los de su recuadro lateral.

Se pide una ficha por equipo, de una en una y con pausa, y cada una se guarda 15 minutos (`PLAYERS_TTL_SECONDS`).
La primera vez que alguien abre un ranking de jugadores tarda unos segundos (18 fichas); después es inmediato.
Si no hay datos en las plantillas, se prueba con la página de ranking de la liga.

Limitación de los porteros: la ficha no indica partidos jugados ni porterías a cero, así que el ranking de porteros
solo incluye a quienes ya han encajado goles.

## Rankings de jugadores

Goleadores, porteros, tarjetas y MVP muestran por cada fila: jugador, equipo (de la columna de la liga o, si no
la hay, de la ficha emergente del jugador), demarcación y la cifra principal (goles, goles encajados...).
Si la página de goleadores no entrega filas, se usa como respaldo el top 3 que la liga publica en la portada del
campeonato y la app lo indica. `npm run diagnose` incluye cómo llegan estas dos páginas.

## Ajustes (variables de entorno)

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `CACHE_TTL_SECONDS` | `600` | Cuánto tiempo se reutilizan los datos antes de volver a pedirlos |
| `PLAYERS_TTL_SECONDS` | `900` | Igual, para las fichas de equipo (plantillas) |
| `COMPETITION_ID` | `15726` | Id de la competición (1ª Divisió). Otros: Èlit `15724`, Preferent `15725`, D. d'Honor `15723` |

## Estructura

```
server.js            servidor HTTP + API JSON (/api/standings, /calendar, /rankings/:tipo, /teams, /committee)
lib/scraper.js       sesión con cookies, descarga y caché (con datos antiguos si la web falla)
lib/parsers.js       HTML → JSON
public/              la app (HTML, CSS, JS sin dependencias, manifest y service worker)
scripts/check.js     comprobación contra la web real
test/                tests de parsers y prueba de extremo a extremo con una liga simulada
```

## Limitaciones conocidas

- Si `calendar.aspx` sólo muestra una jornada por pantalla (con paginación interna de ASP.NET), la app
  mostrará las jornadas que consiga leer; `npm run check` lo indicará. Se puede ampliar replicando el
  formulario de la web.
- Es un uso no oficial de una web ajena: la app identifica su `User-Agent`, espacia las peticiones y
  cachea. Si la liga cambia el diseño de sus páginas, habrá que actualizar `lib/parsers.js`.
- Los datos pertenecen a la liga; úsalos para uso personal o consulta con ellos si vas a publicar la app.

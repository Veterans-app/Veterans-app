'use strict';
/**
 * Comprueba contra la web REAL que los parsers extraen datos.
 *   npm run check
 * Guarda el HTML descargado en ./debug/ para poder ajustar los parsers si algo sale vacío.
 */
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/parsers');
const { rawPages } = require('../lib/scraper');

(async () => {
  console.log('Descargando páginas de la 1ª división…');
  const pages = await rawPages();
  const dir = path.join(__dirname, '..', 'debug');
  fs.mkdirSync(dir, { recursive: true });

  const report = [];
  const ok = (name, cond, detail) => report.push({ name, ok: !!cond, detail });

  for (const [name, html] of Object.entries(pages)) {
    if (typeof html !== 'string') {
      ok(`descarga ${name}`, false, html.error);
      continue;
    }
    fs.writeFileSync(path.join(dir, `${name}.html`), html);
  }

  const get = (n) => (typeof pages[n] === 'string' ? pages[n] : '');
  const standings = P.parseStandings(get('table'));
  const matches = P.mergeMatches(P.parseMatches(get('calendar')), P.parseMatches(get('situation')));
  const rounds = new Set(matches.map((m) => m.round));
  const teams = P.parseTeams(get('teams') || get('situation'));

  ok('clasificación (esperado 18 equipos)', standings.rows.length === 18, `${standings.rows.length} filas, columnas: ${standings.headers.join(', ') || '(sin cabecera)'}`);
  ok('calendario (esperadas 17 jornadas, 153 partidos)', rounds.size >= 17 && matches.length >= 153, `${rounds.size} jornadas, ${matches.length} partidos`);
  ok('partidos con resultado', matches.some((m) => m.status === 'finished'), `${matches.filter((m) => m.status === 'finished').length} jugados`);
  ok('equipos (esperados 18)', teams.length >= 18, `${teams.length} equipos`);
  for (const k of ['scorers', 'goalkeepers', 'cards', 'teams', 'fairplay', 'mvp', 'mvt']) {
    const r = P.parseRanking(get(`stats_${k}`), k);
    const first = r.rows[0];
    const sample = first ? ` · 1º: ${first.name || '?'} | ${first.team || 'sin equipo'} | ${first.main ? first.main.value : '?'}` : '';
    ok(`ranking ${k}`, r.rows.length > 0, `${r.rows.length} filas${sample}`);
  }
  const committee = P.parseGeneric(get('comitte'));
  ok('comité de competición', committee.tables.length > 0, `${committee.tables.length} tablas`);
  const tp = P.parseTeamPage(get('team'));
  ok('ficha de equipo (plantilla con G y tarjetas)', tp.roster.length > 0, `${tp.roster.length} jugadores · goles ${tp.totals.goals} · amarillas ${tp.totals.yellow} · rojas ${tp.totals.red} · próximos partidos ${tp.upcoming.length}`);

  console.log('');
  for (const r of report) console.log(`${r.ok ? '✔' : '✘'} ${r.name}: ${r.detail || ''}`);
  const bad = report.filter((r) => !r.ok);
  console.log(
    bad.length
      ? `\n${bad.length} comprobación(es) con problemas. Revisa ./debug/*.html y ajusta lib/parsers.js (o envía esos ficheros para que se ajusten).`
      : '\nTodo correcto.',
  );
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.error('Error:', e.message);
  process.exit(2);
});

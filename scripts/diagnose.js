'use strict';
/**
 * Diagnóstico del calendario:  npm run diagnose
 * Descarga las páginas reales y escribe un resumen en debug/diagnose.txt
 * (y lo imprime), para ver cómo entrega la liga las jornadas.
 */
const fs = require('node:fs');
const path = require('node:path');
const { rawPages } = require('../lib/scraper');
const { summarize } = require('../lib/diagnose');
const P = require('../lib/parsers');

(async () => {
  console.log('Descargando páginas de la liga…\n');
  const pages = await rawPages();
  const dir = path.join(__dirname, '..', 'debug');
  fs.mkdirSync(dir, { recursive: true });

  const parts = [];
  for (const name of ['situation', 'calendar', 'team', 'table', 'stats_scorers', 'stats_goalkeepers']) {
    const html = pages[name];
    if (typeof html !== 'string') {
      parts.push(`=== ${name} ===\nNO SE PUDO DESCARGAR: ${html ? html.error : 'sin datos'}`);
      continue;
    }
    fs.writeFileSync(path.join(dir, `${name}.html`), html);
    parts.push(summarize(html, name));
  }

  const cal = typeof pages.calendar === 'string' ? pages.calendar : '';
  const sit = typeof pages.situation === 'string' ? pages.situation : '';
  const matches = P.mergeMatches(cal ? P.parseMatches(cal) : [], P.parseMatches(sit));
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  parts.push(
    `=== resultado del extractor ===\npartidos leídos: ${matches.length}\njornadas leídas: ${rounds.join(', ') || '(ninguna)'}\ncon resultado: ${matches.filter((m) => m.status === 'finished').length}`,
  );

  const rk = [];
  for (const kind of ['scorers', 'goalkeepers']) {
    const html = pages[`stats_${kind}`];
    const r = typeof html === 'string' ? P.parseRanking(html, kind) : { rows: [] };
    rk.push(`${kind}: ${r.rows.length} filas`);
    for (const row of r.rows.slice(0, 3)) {
      rk.push(`  ${row.pos}. ${row.name || '?'} | equipo: ${row.team || '(sin equipo)'} | principal: ${row.main ? `${row.main.label || '?'}=${row.main.value}` : '?'} | stats: ${row.stats.map((s) => `${s.label || '?'}=${s.value}`).join(', ')}`);
    }
  }
  const tp = typeof pages.team === 'string' ? P.parseTeamPage(pages.team) : { roster: [], totals: {}, staff: [], upcoming: [], last: [] };
  rk.push(`ficha de equipo: ${tp.roster.length} jugadores · totales G=${tp.totals.goals} GR=${tp.totals.conceded} amarillas=${tp.totals.yellow} rojas=${tp.totals.red} · técnicos ${tp.staff.length} · próximos ${tp.upcoming.length} · últimos ${tp.last.length}`);
  for (const pl of tp.roster.slice(0, 3)) {
    rk.push(`  ${pl.name} | dorsal ${pl.number ?? '-'} | ${pl.position || '-'} | G=${pl.goals} GPP=${pl.ownGoals} GR=${pl.conceded} amarillas=${pl.yellow} rojas=${pl.red}`);
  }
  const topSit = typeof pages.situation === 'string' ? P.parseSituationScorers(pages.situation) : { rows: [] };
  rk.push(`respaldo (top de goleadores en la portada): ${topSit.rows.length} filas`);
  parts.push(`=== extractor de rankings ===\n${rk.join('\n')}`);

  const report = parts.join('\n\n') + '\n';
  fs.writeFileSync(path.join(dir, 'diagnose.txt'), report);
  console.log(report);
  console.log('Guardado en debug/diagnose.txt — copia ese texto (o envía el archivo) para ajustar el calendario.');
})().catch((e) => {
  console.error('Error:', e.message);
  process.exit(2);
});

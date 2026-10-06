'use strict';
/**
 * Resumen estructural de una página de la liga (sin volcar su contenido completo).
 * Sirve para ver cómo entrega la web el calendario por jornadas: desplegables,
 * botones de "postback" de ASP.NET, enlaces y cuántos partidos hay en pantalla.
 */
const cheerio = require('cheerio');

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function summarize(html, label) {
  const $ = cheerio.load(html);
  const out = [];
  const add = (s = '') => out.push(s);
  const uniq = (arr) => [...new Set(arr)];

  add(`=== ${label} ===`);
  add(`título: ${clean($('title').text())}`);
  add(`tamaño: ${html.length} caracteres`);

  const text = clean($('body').text());
  const dates = text.match(/\d{2}\.\d{2}\.\d{4}/g) || [];
  add(`fechas dd.mm.aaaa en pantalla: ${dates.length}${dates.length ? ` (de ${dates[0]} a ${dates[dates.length - 1]})` : ''}`);
  add(`enlaces a partidos (match.aspx): ${$('a[href*="match.aspx"]').length}`);
  add(`equipos distintos (team.aspx): ${uniq($('a[href*="team.aspx"]').map((_, a) => ($(a).attr('href') || '').replace(/.*itm=/, '')).get()).length}`);

  // Rankings de jugadores: cómo está formada la primera fila con un jugador
  const players = $('a[href*="player.aspx"]');
  add(`enlaces a jugadores (player.aspx): ${players.length}`);
  if (players.length) {
    const rowsUp = players.first().parents('tr').toArray();
    const tr = rowsUp.find((r) => $(r).children('td,th').length >= 3) || rowsUp[0];
    if (tr) {
      add(`primera fila con jugador (${$(tr).children('td,th').length} celdas):`);
      $(tr)
        .children('td,th')
        .each((i, c) => {
          const t = clean($(c).text());
          add(`  [${i}] "${t.slice(0, 70)}${t.length > 70 ? '…' : ''}" · tablas dentro: ${$(c).find('table').length} · enlaces: ${$(c).find('a').length}`);
        });
      const head = $(tr).closest('table').find('tr').first();
      add(`  primera fila de esa tabla: ${clean(head.text()).slice(0, 100)}`);
    }
  }

  const rounds = uniq((text.match(/Jornada\s*\d+/gi) || []).map((r) => r.replace(/\s+/g, ' ')));
  add(`jornadas nombradas en el texto: ${rounds.length ? rounds.join(', ') : '(ninguna)'}`);

  const selects = $('select').toArray();
  add(`desplegables <select>: ${selects.length}`);
  for (const s of selects.slice(0, 8)) {
    const opts = $(s).find('option').toArray();
    const sel = $(s).find('option[selected]').first();
    add(`  - name="${$(s).attr('name') || ''}" id="${$(s).attr('id') || ''}" onchange="${clean($(s).attr('onchange')).slice(0, 80)}" opciones=${opts.length}${sel.length ? ` seleccionada="${clean(sel.text())}"` : ''}`);
    add(`      ${opts.slice(0, 6).map((o) => `"${clean($(o).text())}"=${$(o).attr('value')}`).join(' | ')}${opts.length > 6 ? ' …' : ''}`);
  }

  const posts = uniq([...html.matchAll(/__doPostBack\(&?#?39?;?'?([^'")]*)'?,\s*'?([^'")]*)'?\)/g)].map((m) => `${m[1]} , ${m[2]}`));
  const posts2 = uniq([...html.matchAll(/__doPostBack\('([^']*)','([^']*)'\)/g)].map((m) => `${m[1]} , ${m[2]}`));
  const allPosts = uniq([...posts2, ...posts]).slice(0, 25);
  add(`llamadas __doPostBack distintas: ${allPosts.length}`);
  for (const p of allPosts) add(`  - ${p}`);

  const hidden = $('input[type="hidden"]').toArray().map((i) => `${$(i).attr('name')}(${($(i).attr('value') || '').length})`);
  add(`campos ocultos: ${hidden.join(', ') || '(ninguno)'}`);

  const ctrls = $('input[type="submit"],input[type="button"],input[type="image"],button')
    .toArray()
    .slice(0, 15)
    .map((i) => `${$(i).attr('name') || $(i).attr('id') || '?'}="${clean($(i).attr('value') || $(i).text()).slice(0, 25)}"`);
  add(`botones: ${ctrls.join(' | ') || '(ninguno)'}`);

  const navLinks = uniq(
    $('a[href]')
      .toArray()
      .map((a) => $(a).attr('href'))
      .filter((h) => /calendar|itd=|round|jornada|rnd=|jor=/i.test(h || '')),
  ).slice(0, 15);
  add(`enlaces de calendario/jornada: ${navLinks.length}`);
  for (const l of navLinks) add(`  - ${l}`);

  return out.join('\n');
}

module.exports = { summarize };

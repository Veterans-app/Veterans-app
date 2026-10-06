'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/parsers');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('parseMatches: calendario con jornada, fecha, hora, campo y equipos', () => {
  const ms = P.parseMatches(fx('situation.html'));
  assert.equal(ms.length, 4);
  const m = ms.find((x) => x.id === '1367538');
  assert.equal(m.round, 2);
  assert.equal(m.date, '2026-10-03');
  assert.equal(m.time, '15:45');
  assert.equal(m.field.code, 'TEI');
  assert.equal(m.home.name, 'Icart');
  assert.equal(m.away.name, 'C.E.Llinars');
  assert.equal(m.home.shield, 'https://www.veteransfutbol.com/storage/soccer/shields_p/177715.png');
  assert.equal(m.status, 'pending');
  assert.equal(m.homeGoals, null);
});

test('parseMatches: resultados con marcador y estado finalizado', () => {
  const ms = P.parseMatches(fx('situation.html'));
  const m = ms.find((x) => x.id === '1367567');
  assert.equal(m.round, 1);
  assert.equal(m.status, 'finished');
  assert.equal(m.homeGoals, 1);
  assert.equal(m.awayGoals, 3);
  assert.equal(m.home.name, 'La Llantia-B');
});

test('mergeMatches: une por id y prefiere el resultado', () => {
  const a = [{ id: '1', round: 1, date: null, time: '10:00', field: null, home: { id: 'a' }, away: { id: 'b' }, homeGoals: null, awayGoals: null, status: 'pending' }];
  const b = [{ id: '1', round: 1, date: '2026-10-03', time: null, field: { code: 'X' }, home: { id: 'a' }, away: { id: 'b' }, homeGoals: 2, awayGoals: 0, status: 'finished' }];
  const [m] = P.mergeMatches(a, b);
  assert.equal(m.date, '2026-10-03');
  assert.equal(m.time, '10:00');
  assert.equal(m.homeGoals, 2);
  assert.equal(m.status, 'finished');
});

test('parseStandings: clasificación resumida (Equip / PT)', () => {
  const s = P.parseStandings(fx('situation.html'));
  assert.equal(s.rows.length, 3);
  assert.deepEqual(
    s.rows.map((r) => [r.pos, r.team, r.values[0]]),
    [
      [1, 'Inter Premia', '3'],
      [2, 'CE.Pla De Boet', '3'],
      [10, 'At.Colomense', '0'],
    ],
  );
  assert.deepEqual(s.headers, ['PT']);
});

test('parseStandings: clasificación completa con varias columnas', () => {
  const html = `<table><tr><th>#</th><th>Equip</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>PT</th></tr>
    <tr><td>1</td><td><a href="team.aspx?itm=7" title="Alfa FC">Alfa FC</a></td><td>3</td><td>3</td><td>0</td><td>0</td><td>9</td><td>2</td><td>9</td></tr>
    <tr><td>2</td><td><a href="team.aspx?itm=8" title="Beta">Beta</a></td><td>3</td><td>2</td><td>0</td><td>1</td><td>5</td><td>4</td><td>6</td></tr></table>`;
  const s = P.parseStandings(html);
  assert.deepEqual(s.headers, ['PJ', 'PG', 'PE', 'PP', 'GF', 'GC', 'PT']);
  assert.deepEqual(s.rows[0].values, ['3', '3', '0', '0', '9', '2', '9']);
  assert.equal(s.rows[1].team, 'Beta');
});

test('parseRanking: ignora la ficha emergente de jugador', () => {
  const r = P.parseRanking(fx('scorers.html'));
  assert.equal(r.rows.length, 3);
  assert.ok(r.rows.every((row) => row.cells.every((c) => !/Demarcaci/.test(c))));
  assert.ok(r.rows[0].cells.includes('Ayoub Lharrak'));
  assert.ok(r.rows[0].cells.includes('3'));
  assert.equal(r.rows[0].playerId, '2853753');
  // este ranking no trae enlace al equipo: el nombre sale de la ficha emergente y no hay teamId
  assert.equal(r.rows[0].team, 'Dracs At.Canet');
  assert.equal(r.rows[0].teamId, null);
});

test('portada: top de goleadores de respaldo, sin mezclarse con el comité ni la clasificación', () => {
  const r = P.parseSituationScorers(fx('situation_rankings.html'));
  assert.equal(r.rows.length, 3);
  assert.deepEqual(
    r.rows.map((x) => [x.pos, x.name, x.team, x.main && x.main.value]),
    [
      [1, 'Ayoub Lharrak', 'Dracs At.Canet', '3'],
      [2, 'Anthony Nahuel Almeida Acosta', 'Sinera United', '2'],
      [3, 'Juan Jose Franco Bermudez', 'CE.Pla De Boet', '2'],
    ],
  );
  assert.ok(!r.rows.some((x) => /Adil/.test(x.name)), 'no debe incluir al jugador del comité de competición');
});

test('parseTeams: equipos únicos con su nombre completo', () => {
  const t = P.parseTeams(fx('situation.html'));
  const ids = t.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(t.find((x) => x.id === '177715').name, 'Icart');
});

test('parseSituationStats: tarjetas de resumen', () => {
  const s = P.parseSituationStats(fx('situation.html'));
  assert.equal(s['Equips'], '18');
  assert.equal(s['Partits jugats'], '9');
});

test('HTML vacío no rompe nada', () => {
  assert.deepEqual(P.parseMatches('<html></html>'), []);
  assert.deepEqual(P.parseStandings('<html></html>'), { headers: [], rows: [] });
  assert.deepEqual(P.parseRanking('<html></html>'), { headers: [], rows: [] });
});

test('diagnose.summarize: describe jornadas, desplegables y postbacks', () => {
  const { summarize } = require('../lib/diagnose');
  const html = `<html><head><title>Calendari</title></head><body>
    <form><input type="hidden" name="__VIEWSTATE" value="abc">
    <select name="ctl00$ddlRound" onchange="setTimeout('__doPostBack(\\'ctl00$ddlRound\\',\\'\\')', 0)">
      <option value="1">Jornada 1</option><option value="2" selected>Jornada 2</option></select>
    <a href="javascript:__doPostBack('ctl00$btnNext','')">Següent</a>
    <p>Jornada 2</p><p>03.10.2026</p>
    <a href="team.aspx?itm=7">A</a><a href="match.aspx?itm=9">x</a></form></body></html>`;
  const s = summarize(html, 'calendar');
  assert.match(s, /desplegables <select>: 1/);
  assert.match(s, /ctl00\$ddlRound/);
  assert.match(s, /Jornada 1/);
  assert.match(s, /__doPostBack distintas: [1-9]/);
  assert.match(s, /enlaces a partidos \(match\.aspx\): 1/);
  assert.match(s, /fechas dd\.mm\.aaaa en pantalla: 1/);
  assert.match(s, /__VIEWSTATE\(3\)/);
});

test('goleadores: nombre, equipo (de la ficha emergente) y goles, con tablas anidadas', () => {
  const r = P.parseRanking(fx('scorers.html'), 'scorers');
  assert.equal(r.rows.length, 3);
  const [a, b, c] = r.rows;
  assert.equal(a.pos, 1);
  assert.equal(a.name, 'Ayoub Lharrak');
  assert.equal(a.team, 'Dracs At.Canet');
  assert.equal(a.position, 'Davanter');
  assert.deepEqual(a.main, { label: 'Gols', value: '3' });
  assert.deepEqual(a.stats, [{ label: 'PJ', value: '1' }, { label: 'Gols', value: '3' }]);
  assert.equal(a.playerId, '2853753');
  // el prefijo de categoría "(M-34)" se quita y se usa el nombre completo del atributo title
  assert.equal(b.name, 'Anthony Nahuel Almeida Acosta');
  assert.equal(b.team, 'Sinera United');
  assert.equal(c.name, 'Juan Jose Franco Bermudez');
  assert.equal(c.main.value, '2');
  assert.deepEqual(r.headers, ['PJ', 'Gols']);
});

test('porteros: goles encajados como dato principal, equipo por enlace, cabecera sin <th>', () => {
  const r = P.parseRanking(fx('keepers.html'), 'goalkeepers');
  assert.equal(r.rows.length, 2);
  const [a, b] = r.rows;
  assert.equal(a.name, 'Marc Soler Puig');
  assert.equal(a.team, 'C.E.Llinars');
  assert.equal(a.teamId, '177719');
  assert.deepEqual(a.main, { label: 'GE', value: '1' });
  assert.deepEqual(a.stats.map((s) => `${s.label}=${s.value}`), ['PJ=1', 'GE=1', 'Mitjana=1,00']);
  assert.equal(b.main.value, '0');
});

test('ranking sin cabecera: el dato principal de porteros es el segundo valor', () => {
  const html = `<table><tr><td>1</td><td><a href="player.aspx?itm=9" title="Porter Uno">Porter Uno</a></td><td><a href="team.aspx?itm=5" title="Equip Cinc">Equip Cinc</a></td><td>3</td><td>2</td><td>0,66</td></tr>
    <tr><td>2</td><td><a href="player.aspx?itm=8" title="Porter Dos">Porter Dos</a></td><td><a href="team.aspx?itm=6" title="Equip Sis">Equip Sis</a></td><td>3</td><td>4</td><td>1,33</td></tr></table>`;
  const r = P.parseRanking(html, 'goalkeepers');
  assert.equal(r.rows[0].main.value, '2');
  assert.equal(r.rows[0].team, 'Equip Cinc');
});

test('ficha de equipo: plantilla con G, GPP, GR y tarjetas por jugador', () => {
  const t = P.parseTeamPage(fx('team.html'));
  assert.equal(t.roster.length, 18);
  const byName = (n) => t.roster.find((p) => p.name === n);

  const jordi = byName('Jordi Gonzalez Miguelez');
  assert.equal(jordi.number, 17);
  assert.equal(jordi.position, 'MEDIO');
  assert.equal(jordi.playerId, '9001');
  assert.deepEqual([jordi.goals, jordi.ownGoals, jordi.conceded, jordi.yellow, jordi.red], [0, 0, 0, 0, 0]);

  const dwvan = byName('Dwvan Bedoya Correa');
  assert.equal(dwvan.goals, 1);
  assert.equal(dwvan.yellow, 1);
  assert.equal(dwvan.red, 0);
  assert.equal(dwvan.number, null);
  assert.equal(dwvan.position, null);

  // "(M-34)" se quita del nombre y queda como etiqueta; sin él, el nombre completo viene del title
  const juan = byName('Juan Jose Franco Bermudez');
  assert.equal(juan.goals, 2);
  assert.equal(juan.tag, 'M-34');
  assert.equal(juan.number, 9);
  assert.equal(byName('Elias Ammor Ben Said').tag, 'M-34');

  // los totales coinciden con la fila de totales de la web (3 0 0 3 0)
  assert.deepEqual(t.totals, { goals: 3, ownGoals: 0, conceded: 0, yellow: 3, red: 0 });
});

test('ficha de equipo: tarjetas rojas identificadas aunque la carpeta de imágenes se llame "shared"', () => {
  const html = `<table><tr><th></th><th>NOMBRE</th><th>G</th><th>GPP</th><th>GR</th>
      <th><img src="/images/shared/16yellowcard.png"></th><th><img src="/images/shared/16redcard.png"></th></tr>
    <tr><td></td><td><a href="player.aspx?itm=1">Pepe Roig</a></td><td>-</td><td>1</td><td>4</td><td>2</td><td>1</td></tr></table>`;
  const [p] = P.parseTeamPage(html).roster;
  assert.deepEqual([p.goals, p.ownGoals, p.conceded, p.yellow, p.red], [0, 1, 4, 2, 1]);
});

test('ficha de equipo: cabecera en catalán y nombres sin enlace', () => {
  const html = `<table><tr><th></th><th></th><th>NOM</th><th>G</th><th>GPP</th><th>GR</th><th><img src="groga.png"></th><th><img src="vermella.png"></th></tr>
    <tr><td>1</td><td>PORTER</td><td>Marc Soler</td><td>-</td><td>-</td><td>3</td><td>-</td><td>1</td></tr>
    <tr><td>9</td><td>DAVANTER</td><td>Pere Vila</td><td>5</td><td>-</td><td>-</td><td>2</td><td>-</td></tr>
    <tr><td></td><td></td><td></td><td>5</td><td>0</td><td>3</td><td>2</td><td>1</td></tr></table>`;
  const r = P.parseTeamPage(html).roster;
  assert.equal(r.length, 2);
  assert.equal(r[0].name, 'Marc Soler');
  assert.equal(r[0].position, 'PORTER');
  assert.equal(r[0].conceded, 3);
  assert.equal(r[0].red, 1);
  assert.equal(r[1].goals, 5);
  assert.equal(r[1].yellow, 2);
});

test('ficha de equipo: cuerpo técnico', () => {
  const t = P.parseTeamPage(fx('team.html'));
  assert.deepEqual(t.staff, [{ name: 'Ferney Gil Gutierrez', role: 'Entrenador', yellow: 0, red: 0 }]);
});

test('ficha de equipo: próximos y últimos partidos del recuadro lateral', () => {
  const t = P.parseTeamPage(fx('team.html'));
  assert.deepEqual(t.upcoming, [
    { date: '2026-10-11', time: null, homeCode: 'ALA', awayCode: 'BOE', matchId: '1367545' },
    { date: '2026-10-18', time: null, homeCode: 'CAR', awayCode: 'BOE', matchId: '1367555' },
    { date: '2026-10-25', time: null, homeCode: 'BOE', awayCode: 'SIB', matchId: '1367566' },
  ]);
  assert.deepEqual(t.last, [{ homeCode: 'BOE', homeGoals: 3, awayGoals: 0, awayCode: 'ICA', matchId: '1367565' }]);
});

test('ficha de equipo: página vacía no rompe', () => {
  const t = P.parseTeamPage('<html></html>');
  assert.deepEqual(t.roster, []);
  assert.deepEqual(t.upcoming, []);
  assert.deepEqual(t.totals, { goals: 0, ownGoals: 0, conceded: 0, yellow: 0, red: 0 });
});

test('rankings calculados con las plantillas: goleadores, tarjetas y porteros', () => {
  const t = P.parseTeamPage(fx('team.html'));
  const boet = { id: '177711', name: 'CE.Pla De Boet', shield: 's' };
  const other = {
    id: '177719',
    name: 'C.E.Llinars',
    shield: 's2',
    roster: [
      { name: 'Marc Soler', playerId: '5', position: 'PORTER', goals: 0, ownGoals: 0, conceded: 3, yellow: 0, red: 1 },
      { name: 'Pere Vila', playerId: '6', position: null, goals: 2, ownGoals: 0, conceded: 0, yellow: 2, red: 0 },
    ],
  };
  const list = [
    { team: boet, roster: t.roster },
    { team: { id: other.id, name: other.name, shield: other.shield }, roster: other.roster },
  ];

  const sc = P.rankingFromRosters(list, 'scorers');
  assert.deepEqual(sc.rows.map((r) => [r.pos, r.name, r.team, r.main.value]), [
    [1, 'Juan Jose Franco Bermudez', 'CE.Pla De Boet', '2'],
    [1, 'Pere Vila', 'C.E.Llinars', '2'], // empate a 2 goles: misma posición
    [3, 'Dwvan Bedoya Correa', 'CE.Pla De Boet', '1'],
  ]);

  const cards = P.rankingFromRosters(list, 'cards');
  assert.equal(cards.rows[0].name, 'Pere Vila'); // 2 tarjetas; Marc Soler (1 roja) y los de Boet con 1 amarilla le siguen
  assert.equal(cards.rows[0].main.value, '2');
  assert.deepEqual(cards.rows[0].stats, [{ label: 'Grogues', value: '2' }, { label: 'Vermelles', value: '0' }]);
  assert.equal(cards.rows.find((r) => r.name === 'Marc Soler').main.value, '1');

  const gk = P.rankingFromRosters(list, 'goalkeepers');
  assert.deepEqual(gk.rows.map((r) => [r.name, r.main.value]), [['Marc Soler', '3']]);
  assert.deepEqual(P.rankingFromRosters(list, 'mvp'), { headers: [], rows: [] });
});

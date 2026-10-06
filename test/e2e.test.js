'use strict';
// Prueba de extremo a extremo con una "liga" simulada: exige la cookie de sesión
// que sólo se entrega al visitar situation.aspx, igual que la web real.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('API completa contra una liga simulada (con sesión por cookie)', async () => {
  const hits = [];
  const fake = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push(url.pathname);
    const hasSession = /ASP\.NET_SessionId=abc123/.test(req.headers.cookie || '');
    const html = (b) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(b);
    };
    if (url.pathname.endsWith('situation.aspx')) {
      res.setHeader('Set-Cookie', 'ASP.NET_SessionId=abc123; path=/; HttpOnly');
      return html(fx('situation.html'));
    }
    if (!hasSession) return html('<html><body>Sin campeonato seleccionado</body></html>');
    if (url.pathname.endsWith('table.aspx')) return html(fx('situation.html'));
    if (url.pathname.endsWith('calendar.aspx')) return html(fx('situation.html'));
    if (url.pathname.endsWith('stats_scorers.aspx')) return html(fx('scorers.html'));
    // fichas de equipo: sólo el Pla de Boet (177711) tiene plantilla; el resto, página sin datos
    if (url.pathname.endsWith('team.aspx')) {
      return html(url.searchParams.get('itm') === '177711' ? fx('team.html') : '<html><body></body></html>');
    }
    html('<html><body></body></html>');
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.SITE_BASE = `http://localhost:${fake.address().port}`;
  process.env.CACHE_TTL_SECONDS = '60';

  const { api } = require('../lib/scraper');
  try {
    const st = await api.standings();
    assert.equal(st.rows[0].team, 'Inter Premia');

    const cal = await api.calendar();
    assert.deepEqual(cal.rounds, [1, 2]);
    assert.equal(cal.matches.length, 4);

    // goleadores: salen de la plantilla de cada equipo (columna G), no de la página de ranking de la liga
    const sc = await api.ranking('scorers');
    assert.equal(sc.kind, 'scorers');
    assert.equal(sc.source, 'plantillas');
    assert.equal(sc.partial, false);
    assert.deepEqual(
      sc.rows.map((r) => [r.pos, r.name, r.team, r.main.value]),
      [
        [1, 'Juan Jose Franco Bermudez', 'CE.Pla De Boet', '2'],
        [2, 'Dwvan Bedoya Correa', 'CE.Pla De Boet', '1'],
      ],
    );
    assert.equal(sc.rows[0].teamId, '177711');
    assert.equal(sc.coverage.teamsWithRoster, 1);
    assert.ok(sc.coverage.teamsTotal > 1);

    // tarjetas: amarillas y rojas por jugador, de la misma plantilla
    const cards = await api.ranking('cards');
    assert.equal(cards.source, 'plantillas');
    assert.equal(cards.rows.length, 3);
    assert.ok(cards.rows.every((r) => r.main.value === '1'));

    // un ranking sin datos no rompe: devuelve la lista vacía
    const gk = await api.ranking('goalkeepers');
    assert.equal(gk.rows.length, 0);

    const teams = await api.teams();
    assert.ok(teams.teams.length >= 5);

    // ficha de equipo: United Legends juega la J1 (ya jugada) y la J2 (pendiente)
    const ut = await api.team('177712');
    assert.equal(ut.team.name, 'United Legends');
    assert.equal(ut.upcoming.length, 1);
    assert.equal(ut.upcoming[0].round, 2);
    assert.equal(ut.results.length, 1);
    assert.equal(ut.results[0].awayGoals, 3);

    // equipo que está en la clasificación: trae su posición y puntos
    const inter = await api.team('177716');
    assert.equal(inter.standing.pos, 1);
    assert.deepEqual(inter.standing.values, ['3']);

    // ficha completa del Pla de Boet: plantilla, técnico y partidos del recuadro lateral
    const boet = await api.team('177711');
    assert.equal(boet.team.name, 'CE.Pla De Boet');
    assert.equal(boet.standing.pos, 2);
    assert.equal(boet.squad.roster.length, 18);
    assert.deepEqual(boet.squad.totals, { goals: 3, ownGoals: 0, conceded: 0, yellow: 3, red: 0 });
    assert.equal(boet.squad.staff[0].name, 'Ferney Gil Gutierrez');
    assert.deepEqual(
      boet.upcoming.map((m) => [m.id, m.date, m.home.code, m.away.code]),
      [
        ['1367545', '2026-10-11', 'ALA', 'BOE'],
        ['1367555', '2026-10-18', 'CAR', 'BOE'],
        ['1367566', '2026-10-25', 'BOE', 'SIB'],
      ],
    );
    assert.equal(boet.upcoming[2].home.id, '177711', 'el equipo propio queda como local en el tercer partido');
    // el último resultado: el rival (ICA) se resuelve con el calendario -> Icart
    assert.equal(boet.results.length, 1);
    assert.equal(boet.results[0].away.name, 'Icart');
    assert.equal(boet.results[0].away.id, '177715');
    assert.deepEqual([boet.results[0].homeGoals, boet.results[0].awayGoals], [3, 0]);

    // un equipo sin plantilla legible sigue funcionando (sólo calendario)
    assert.equal(ut.squad.roster.length, 0);

    // la lista de equipos incluye los de la clasificación y los del calendario
    assert.ok(teams.teams.some((t) => t.id === '177716') && teams.teams.some((t) => t.id === '177712'));

    await assert.rejects(() => api.team('999'), /no encontrado/);

    // segunda llamada: sale de la caché, sin nuevas peticiones a la liga
    const before = hits.length;
    const again = await api.standings();
    assert.equal(again._cache, 'hit');
    assert.equal(hits.length, before);

    await assert.rejects(() => api.ranking('inventado'), /desconocido/);
    assert.throws(() => api.team('abc'), /no válido/);
  } finally {
    fake.close();
  }
});

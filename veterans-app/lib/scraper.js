'use strict';
/**
 * Descarga de páginas de la 1ª división con sesión (cookies) y caché en memoria.
 *
 * La web guarda en la sesión ASP.NET qué campeonato está seleccionado: las páginas
 * table.aspx, calendar.aspx, stats_*.aspx... no llevan el id del campeonato en la URL,
 * así que primero hay que visitar situation.aspx?itm=15726 (1ª división) y reutilizar
 * las cookies que devuelve.
 */
const P = require('./parsers');

const BASE = P.BASE;
const COMPETITION_ID = process.env.COMPETITION_ID || '15726'; // LLIGA DE 1ª.DIVISIÓ
const SITUATION = `/mod/soccer/situation.aspx?itm=${COMPETITION_ID}`;
const UA = 'Mozilla/5.0 (compatible; Veterans1aDivisioApp/1.0; uso personal)';
const SESSION_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_SECONDS || 600) * 1000;
const SQUAD_TTL_MS = Number(process.env.PLAYERS_TTL_SECONDS || 900) * 1000; // fichas de equipo
const MIN_GAP_MS = 400; // pausa mínima entre peticiones para no cargar la web

const RANKING_PAGES = {
  scorers: 'stats_scorers.aspx',
  goalkeepers: 'stats_goalkeepers.aspx',
  cards: 'stats_cards.aspx',
  teams: 'stats_teams.aspx',
  fairplay: 'stats_fairplay.aspx',
  mvp: 'stats_mvp.aspx',
  mvt: 'stats_mvt.aspx',
};

class Session {
  constructor() {
    this.cookies = new Map();
    this.createdAt = 0;
    this.lastRequestAt = 0;
    this.queue = Promise.resolve();
  }

  expired() {
    return Date.now() - this.createdAt > SESSION_TTL_MS;
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of list) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  /** GET con cookies, redirecciones manuales y cola (una petición a la vez). */
  get(path) {
    const run = async () => {
      const wait = this.lastRequestAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      let url = path.startsWith('http') ? path : BASE + path;
      for (let hop = 0; hop < 5; hop++) {
        const res = await fetch(url, {
          redirect: 'manual',
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'es,ca;q=0.8,en;q=0.5',
            Cookie: this.cookieHeader(),
          },
          signal: AbortSignal.timeout(20000),
        });
        this.storeCookies(res);
        this.lastRequestAt = Date.now();
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          url = new URL(res.headers.get('location'), url).href;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
        return res.text();
      }
      throw new Error('Demasiadas redirecciones');
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async init() {
    this.cookies.clear();
    const html = await this.get(SITUATION);
    this.createdAt = Date.now();
    this.situationHtml = html;
    return html;
  }
}

let session = new Session();
const cache = new Map(); // key -> { at, data }
const inflight = new Map();

async function page(path) {
  if (session.expired()) await session.init();
  return session.get(path);
}

/** Descarga una página de competición; si no se ve el contexto del campeonato, renueva la sesión una vez. */
async function competitionPage(path, looksValid) {
  let html = await page(path);
  if (looksValid && !looksValid(html)) {
    session = new Session();
    await session.init();
    html = await session.get(path);
  }
  return html;
}

async function cached(key, loader, ttl = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return { ...hit.data, _cache: 'hit' };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await loader();
      data.updatedAt = new Date().toISOString();
      cache.set(key, { at: Date.now(), data });
      return { ...data, _cache: 'miss' };
    } catch (err) {
      // si falla la web, servimos lo último que teníamos (aunque esté caducado)
      if (hit) return { ...hit.data, _cache: 'stale', _error: String(err.message || err) };
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

const hasTeams = (html) => /team\.aspx\?itm=/.test(html);

/** Ficha de un equipo (plantilla, técnicos y recuadros laterales): una petición por equipo, con su propia caché. */
function squadFor(id) {
  return cached(
    `squad:${id}`,
    async () => P.parseTeamPage(await competitionPage(`/mod/soccer/team.aspx?itm=${id}`, null)),
    SQUAD_TTL_MS,
  );
}

/** Plantillas de todos los equipos (de una en una, respetando la pausa entre peticiones). */
async function rosters() {
  const { teams } = await api.teams();
  const list = [];
  let failed = 0;
  for (const t of teams) {
    try {
      const sq = await squadFor(t.id);
      list.push({ team: { id: t.id, name: t.name, shield: t.shield }, roster: sq.roster });
    } catch (e) {
      failed++;
    }
  }
  return {
    list,
    teamsTotal: teams.length,
    teamsRead: teams.length - failed,
    teamsWithRoster: list.filter((x) => x.roster.length).length,
  };
}

const ROSTER_KINDS = new Set(['scorers', 'cards', 'goalkeepers']);

/**
 * Partidos del recuadro lateral de la ficha ("PRÓXIMOS / ÚLTIMOS PARTIDOS"): sólo traen las abreviaturas de los
 * equipos, que se resuelven con las del calendario. Se descartan los que el calendario ya tiene (mismo id de partido).
 */
function sidebarMatches(side, team, calMatches, knownIds) {
  const byCode = new Map();
  for (const m of calMatches) {
    for (const t of [m.home, m.away]) {
      if (!t.id || !t.code) continue;
      if (!byCode.has(t.code)) byCode.set(t.code, new Map());
      byCode.get(t.code).set(t.id, t);
    }
  }
  // abreviatura propia: la del calendario o, si no hay, la que más se repite en el recuadro
  let own = null;
  for (const m of calMatches) {
    if (m.home.id === team.id) own = m.home.code;
    else if (m.away.id === team.id) own = m.away.code;
    if (own) break;
  }
  if (!own) {
    const count = new Map();
    for (const e of [...side.upcoming, ...side.last]) {
      for (const c of [e.homeCode, e.awayCode]) count.set(c, (count.get(c) || 0) + 1);
    }
    own = ([...count.entries()].sort((a, b) => b[1] - a[1])[0] || [])[0] || null;
  }
  if (!own) return { upcoming: [], results: [] };

  const self = { id: team.id, name: team.name, code: own, shield: team.shield };
  const resolve = (code) => {
    const found = byCode.has(code) ? [...byCode.get(code).values()].filter((t) => t.id !== team.id) : [];
    return found.length === 1 ? found[0] : { id: null, name: code, code, shield: null }; // sin resolver o ambigua
  };
  const sides = (e) =>
    e.homeCode === own ? { home: self, away: resolve(e.awayCode) } : e.awayCode === own ? { home: resolve(e.homeCode), away: self } : null;
  const fresh = (e) => !(e.matchId && knownIds.has(e.matchId));

  const upcoming = side.upcoming
    .filter(fresh)
    .map((e) => {
      const s = sides(e);
      return s && { id: e.matchId, round: null, date: e.date, time: e.time, field: null, ...s, homeGoals: null, awayGoals: null, status: 'pending', source: 'ficha' };
    })
    .filter(Boolean);
  const results = side.last
    .filter(fresh)
    .map((e) => {
      const s = sides(e);
      return s && { id: e.matchId, round: null, date: null, time: null, field: null, ...s, homeGoals: e.homeGoals, awayGoals: e.awayGoals, status: 'finished', source: 'ficha' };
    })
    .filter(Boolean);
  return { upcoming, results };
}

const api = {
  /** Clasificación completa (table.aspx). */
  standings: () =>
    cached('standings', async () => {
      const html = await competitionPage('/mod/soccer/table.aspx', hasTeams);
      const parsed = P.parseStandings(html);
      if (!parsed.rows.length) {
        // plan B: la clasificación resumida de la página de situación
        const sit = P.parseStandings(session.situationHtml || (await page(SITUATION)));
        return { ...sit, partial: true };
      }
      return { ...parsed, partial: false };
    }),

  /** Calendario + resultados: une calendar.aspx con la página de situación. */
  calendar: () =>
    cached('calendar', async () => {
      const [cal, sit] = await Promise.all([
        competitionPage('/mod/soccer/calendar.aspx', hasTeams).catch(() => ''),
        page(SITUATION).catch(() => session.situationHtml || ''),
      ]);
      const matches = P.mergeMatches(cal ? P.parseMatches(cal) : [], P.parseMatches(sit));
      const rounds = [...new Set(matches.map((m) => m.round).filter((r) => r != null))].sort((a, b) => a - b);
      return { matches, rounds, stats: P.parseSituationStats(sit) };
    }),

  ranking: (kind) =>
    cached(`ranking:${kind}`, async () => {
      const file = RANKING_PAGES[kind];
      if (!file) throw Object.assign(new Error('Ranking desconocido'), { status: 404 });

      // Goleadores, tarjetas y porteros se calculan con la plantilla de cada equipo (G y tarjetas por jugador)
      if (ROSTER_KINDS.has(kind)) {
        const r = await rosters();
        const agg = P.rankingFromRosters(r.list, kind);
        if (agg.rows.length) {
          return {
            kind,
            headers: [],
            rows: agg.rows,
            partial: false,
            source: 'plantillas',
            coverage: { teamsRead: r.teamsRead, teamsWithRoster: r.teamsWithRoster, teamsTotal: r.teamsTotal },
            note:
              kind === 'goalkeepers'
                ? 'Solo aparecen los porteros que han encajado goles: la ficha del equipo no indica partidos jugados ni porterías a cero.'
                : null,
          };
        }
      }

      // Si no hay datos en las plantillas, se prueba con la página de ranking de la liga
      const html = await competitionPage(`/mod/soccer/${file}`, null);
      let data = P.parseRanking(html, kind);
      let partial = false;

      // Respaldo: si la página del ranking de goleadores no da filas, usamos el top 3 de la portada
      if (kind === 'scorers' && !data.rows.length) {
        const sit = session.situationHtml || (await page(SITUATION).catch(() => ''));
        const top = sit ? P.parseSituationScorers(sit) : { headers: [], rows: [] };
        if (top.rows.length) {
          data = top;
          partial = true;
        }
      }

      // Enlaza cada jugador con su equipo (por nombre) para poder abrir la ficha del equipo
      const standings = await api.standings().catch(() => ({ rows: [] }));
      const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const byName = new Map(standings.rows.map((r) => [norm(r.team), r]));
      for (const row of data.rows) {
        if (!row.teamId && row.team && byName.has(norm(row.team))) {
          const t = byName.get(norm(row.team));
          row.teamId = t.teamId;
          row.shield = t.shield;
        }
      }
      return { kind, headers: data.headers, rows: data.rows, partial };
    }),

  /**
   * Equipos de la competición: unión de la clasificación y de los partidos del calendario
   * (así la lista no depende de que teams.aspx se pueda leer). Si aun así hay menos de 2,
   * se recurre a teams.aspx.
   */
  teams: () =>
    cached('teams', async () => {
      const [st, cal] = await Promise.all([api.standings().catch(() => ({ rows: [] })), api.calendar().catch(() => ({ matches: [] }))]);
      const map = new Map();
      for (const r of st.rows) map.set(r.teamId, { id: r.teamId, name: r.team, shield: r.shield, pos: r.pos });
      for (const m of cal.matches) {
        for (const t of [m.home, m.away]) {
          if (t.id && !map.has(t.id)) map.set(t.id, { id: t.id, name: t.name, shield: t.shield });
        }
      }
      let teams = [...map.values()];
      if (teams.length < 2) {
        const html = await competitionPage('/mod/soccer/teams.aspx', hasTeams).catch(() => '');
        teams = html ? P.parseTeams(html) : [];
      }
      teams.sort((a, b) => a.name.localeCompare(b.name, 'ca'));
      return { teams };
    }),

  /**
   * Ficha de equipo: posición en la tabla, próximos partidos y resultados (calendario + recuadros de la ficha),
   * plantilla con goles y tarjetas por jugador, y cuerpo técnico.
   */
  team: (id) => {
    id = String(id);
    if (!/^\d+$/.test(id)) throw Object.assign(new Error('Id de equipo no válido'), { status: 400 });
    return cached(`team:${id}`, async () => {
      const [st, cal, squad] = await Promise.all([
        api.standings().catch(() => ({ rows: [], headers: [] })),
        api.calendar().catch(() => ({ matches: [], rounds: [], stats: {} })),
        squadFor(id).catch(() => null),
      ]);
      const mine = cal.matches.filter((m) => m.home.id === id || m.away.id === id);
      const row = st.rows.find((r) => r.teamId === id);
      let team = row ? { id, name: row.team, shield: row.shield } : null;
      if (!team && mine.length) {
        const t = mine[0].home.id === id ? mine[0].home : mine[0].away;
        team = { id, name: t.name, shield: t.shield };
      }
      if (!team) {
        const tl = await api.teams().catch(() => ({ teams: [] }));
        const t = tl.teams.find((x) => x.id === id);
        if (t) team = { id, name: t.name, shield: t.shield };
      }
      if (!team) throw Object.assign(new Error('Equipo no encontrado'), { status: 404 });

      let upcoming = mine.filter((m) => m.status !== 'finished');
      let results = mine.filter((m) => m.status === 'finished').reverse();
      if (squad) {
        const extra = sidebarMatches(squad, team, cal.matches, new Set(mine.map((m) => m.id).filter(Boolean)));
        upcoming = [...upcoming, ...extra.upcoming].sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.time || '').localeCompare(b.time || ''));
        results = [...extra.results, ...results];
      }
      return {
        team,
        standing: row ? { pos: row.pos, headers: st.headers, values: row.values } : null,
        upcoming,
        results,
        squad: squad ? { roster: squad.roster, totals: squad.totals, staff: squad.staff } : null,
        coverage: {
          roundsRead: cal.rounds.length,
          roundsTotal: Number(String((cal.stats && cal.stats['Jornades']) || '').replace(/\D/g, '')) || null,
        },
      };
    });
  },

  committee: () =>
    cached('committee', async () => {
      const html = await competitionPage('/mod/soccer/comitte.aspx', null);
      return P.parseGeneric(html);
    }),
};

/** Descarga cruda para el script de comprobación / depuración. */
async function rawPages() {
  const s = new Session();
  await s.init();
  const files = {
    situation: SITUATION,
    table: '/mod/soccer/table.aspx',
    calendar: '/mod/soccer/calendar.aspx',
    teams: '/mod/soccer/teams.aspx',
    comitte: '/mod/soccer/comitte.aspx',
    ...Object.fromEntries(Object.entries(RANKING_PAGES).map(([k, f]) => [`stats_${k}`, `/mod/soccer/${f}`])),
  };
  const out = {};
  for (const [name, path] of Object.entries(files)) {
    try {
      out[name] = await s.get(path);
    } catch (e) {
      out[name] = { error: String(e.message || e) };
    }
  }
  // una ficha de equipo de ejemplo (la primera que aparezca en la página de situación)
  if (typeof out.situation === 'string') {
    const first = P.parseTeams(out.situation)[0];
    if (first) {
      try {
        out.team = await s.get(`/mod/soccer/team.aspx?itm=${first.id}`);
      } catch (e) {
        out.team = { error: String(e.message || e) };
      }
    }
  }
  return out;
}

module.exports = { api, rawPages, RANKING_PAGES, COMPETITION_ID };

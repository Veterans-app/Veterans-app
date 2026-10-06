'use strict';
/**
 * Parsers puros (HTML -> JSON) para las páginas de veteransfutbol.com.
 *
 * La web es ASP.NET WebForms con tablas anidadas y sin clases CSS estables, así que
 * en lugar de depender de selectores frágiles nos apoyamos en patrones de enlaces
 * que sí son estables:
 *   - team.aspx?itm=ID      -> equipo
 *   - match.aspx?itm=ID     -> partido
 *   - player.aspx?itm=ID    -> jugador
 *   - installations.aspx?... -> campo
 * y en los formatos de fecha (dd.mm.aaaa), hora (hh:mm) y marcador ("2 - 1").
 */
const cheerio = require('cheerio');

const BASE = process.env.SITE_BASE || 'https://www.veteransfutbol.com';

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const abs = (u) => (!u ? null : /^https?:/i.test(u) ? u : new URL(u, BASE + '/mod/soccer/').href);
const idFrom = (href, page) => {
  const m = new RegExp(page + '\\.aspx\\?[^"\']*?itm=(\\d+)', 'i').exec(href || '');
  return m ? m[1] : null;
};
const shieldUrl = (teamId) => `${BASE}/storage/soccer/shields_p/${teamId}.png`;

/** Las celdas con la ficha emergente de jugador (tooltip) son ruido para una tabla. */
const isTooltipCell = (text) => /Demarcaci[oó]/i.test(text) && /Edat|Edad/i.test(text);

/**
 * Texto de una celda: si tiene un enlace propio, usa el texto del primer enlace con texto.
 * Los enlaces que están dentro de una tabla anidada (p. ej. las estrellas de la ficha emergente)
 * no cuentan. La ficha emergente se devuelve entera para poder detectarla.
 */
function cellText($, cell) {
  const $c = $(cell);
  const full = clean($c.text());
  if (isTooltipCell(full)) return full;
  const own = $c.closest('table')[0];
  const a = $c
    .find('a')
    .filter((_, el) => clean($(el).text()) !== '' && $(el).closest('table')[0] === own)
    .first();
  return a.length ? clean(a.text()) : full;
}

/** Enlaces de una fila que NO pertenecen a una fila de una tabla anidada. */
const ownLinks = ($, tr, selector) => $(tr).find(selector).filter((_, a) => $(a).closest('tr')[0] === tr);

function teamFromAnchor($, a) {
  const $a = $(a);
  const id = idFrom($a.attr('href'), 'team');
  return {
    id,
    name: clean($a.attr('title')) || clean($a.text()),
    code: clean($a.text()),
    shield: id ? shieldUrl(id) : null,
  };
}

/**
 * Extrae las tablas de la página con su cabecera y filas.
 *
 * - Sólo se cuentan las filas que pertenecen a la propia tabla (no a una tabla anidada), de modo que
 *   las fichas emergentes de jugador (que llevan una tabla dentro de la celda) no hacen que se descarte
 *   la tabla entera.
 * - `wrapper: true` marca las tablas de maquetación (sus celdas contienen otras tablas con datos).
 * Devuelve [{ headers, wrapper, rows: [{ cells, teamId, teamName, playerId, playerName, tooltip }] }]
 */
function parseTables(html) {
  const $ = cheerio.load(html);
  const tables = [];
  $('table').each((_, table) => {
    const trs = $(table)
      .find('tr')
      .filter((__, tr) => $(tr).closest('table')[0] === table)
      .toArray();
    const rows = [];
    let headers = [];
    let wrapper = false;
    for (const tr of trs) {
      const $tr = $(tr);
      const cellEls = $tr.children('th,td').toArray();
      if (!cellEls.length) continue;
      let tooltip = null;
      const kept = [];
      for (const c of cellEls) {
        const text = cellText($, c);
        if (text === '') continue;
        if (isTooltipCell(text)) {
          tooltip = text;
          continue;
        }
        if ($(c).find('table').length && text.length > 400) wrapper = true;
        kept.push(text);
      }
      if (!kept.length) continue;
      const hasTh = $tr.children('th').length > 0;
      if (hasTh && !headers.length) {
        headers = kept;
        continue;
      }
      const teamA = ownLinks($, tr, 'a[href*="team.aspx"]').first();
      const playerA = ownLinks($, tr, 'a[href*="player.aspx"]').first();
      rows.push({
        cells: kept,
        teamId: teamA.length ? idFrom(teamA.attr('href'), 'team') : null,
        teamName: teamA.length ? clean(teamA.attr('title')) || clean(teamA.text()) : null,
        playerId: playerA.length ? idFrom(playerA.attr('href'), 'player') : null,
        playerName: playerA.length ? { title: clean(playerA.attr('title')), text: clean(playerA.text()) } : null,
        tooltip,
        hasLink: !!(teamA.length || playerA.length),
      });
    }
    // Sin <th>: si la primera fila no tiene enlaces ni números sueltos, es la cabecera.
    if (!headers.length && rows.length >= 2) {
      const r0 = rows[0];
      if (!r0.hasLink && r0.cells.length >= 2 && r0.cells.every((c) => !/^[\d.,]+$/.test(c))) {
        headers = r0.cells;
        rows.shift();
      }
    }
    if (rows.length) tables.push({ headers, wrapper, rows });
  });
  return tables;
}

/** Clasificación: la tabla con más filas que enlazan a un equipo. */
function parseStandings(html) {
  const tables = parseTables(html);
  let best = null;
  let bestScore = 0;
  for (const t of tables) {
    const score = t.rows.filter((r) => r.teamId).length;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  if (!best) return { headers: [], rows: [] };
  const rows = best.rows
    .filter((r) => r.teamId)
    .map((r, i) => {
      // posición = primer número entero de la fila; el resto de celdas tras el nombre del equipo
      const posCell = r.cells.find((c) => /^\d+$/.test(c));
      const teamIdx = r.cells.findIndex((c) => c === r.teamName || c === (r.teamName || '').replace(/\s+/g, ' '));
      const after = teamIdx >= 0 ? r.cells.slice(teamIdx + 1) : r.cells.filter((c) => c !== posCell).slice(1);
      return {
        pos: posCell ? Number(posCell) : i + 1,
        teamId: r.teamId,
        team: r.teamName,
        shield: shieldUrl(r.teamId),
        values: after,
      };
    });
  // Cabecera de las columnas de valores (todo lo que va tras "Equip")
  let headers = best.headers.slice();
  const eqIdx = headers.findIndex((h) => /^equip/i.test(h));
  headers = eqIdx >= 0 ? headers.slice(eqIdx + 1) : [];
  if (headers.length !== (rows[0] ? rows[0].values.length : 0)) headers = [];
  return { headers, rows };
}

const DATE_RE = /(\d{2})\.(\d{2})\.(\d{4})/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const SCORE_RE = /^(\d+)\s*-\s*(\d+)$/;

/**
 * Partidos (calendario y resultados). Recorre el documento en orden, recordando la
 * "Jornada N" vigente, y construye un partido por cada fila con dos enlaces a equipos.
 */
function parseMatches(html) {
  const $ = cheerio.load(html);
  const out = [];
  let round = null;
  $('body')
    .find('*')
    .each((_, el) => {
      const $el = $(el);
      const tag = el.tagName;
      const isLeafRow = tag === 'tr' && $el.find('tr').length === 0;
      if (!isLeafRow) {
        if ($el.children().length === 0) {
          const m = /^Jornada\s*(\d+)$/i.exec(clean($el.text()));
          if (m) round = Number(m[1]);
        }
        return;
      }
      const text = clean($el.text());
      const teams = $el.find('a[href*="team.aspx"]').toArray();
      if (teams.length < 2) {
        const m = /^Jornada\s*(\d+)/i.exec(text);
        if (m) round = Number(m[1]);
        return;
      }
      const cells = $el.children('td,th').toArray().map((c) => clean($(c).text()));
      const dm = DATE_RE.exec(text);
      const time = cells.map((c) => TIME_RE.exec(c)).find(Boolean);
      const scoreCell = cells.map((c) => SCORE_RE.exec(c)).find(Boolean);
      const fieldA = $el.find('a[href*="installations.aspx"]').first();
      const matchA = $el.find('a[href*="match.aspx"]').first();
      const statusImg = $el
        .find('img[title]')
        .toArray()
        .map((i) => $(i).attr('title'))
        .find((t) => /Partit/i.test(t || ''));
      let status = 'pending';
      if (scoreCell) status = 'finished';
      else if (/ajorn/i.test(statusImg || '')) status = 'postponed';
      else if (/susp/i.test(statusImg || '')) status = 'suspended';
      else if (/finalit/i.test(statusImg || '')) status = 'finished';
      const matchId = matchA.length ? idFrom(matchA.attr('href'), 'match') : null;
      out.push({
        id: matchId,
        round,
        date: dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null,
        time: time ? `${time[1].padStart(2, '0')}:${time[2]}` : null,
        field: fieldA.length
          ? { id: idFrom(fieldA.attr('href'), 'installations'), code: clean(fieldA.text()) }
          : null,
        home: teamFromAnchor($, teams[0]),
        away: teamFromAnchor($, teams[1]),
        homeGoals: scoreCell ? Number(scoreCell[1]) : null,
        awayGoals: scoreCell ? Number(scoreCell[2]) : null,
        status,
      });
    });
  return out;
}

/** Une listas de partidos por id (o por jornada+equipos), prefiriendo el dato más completo. */
function mergeMatches(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const m of list) {
      const key = m.id || `${m.round}|${m.home.id}|${m.away.id}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...m });
        continue;
      }
      const merged = { ...prev };
      for (const k of Object.keys(m)) {
        if (m[k] !== null && m[k] !== undefined && (merged[k] === null || merged[k] === undefined)) merged[k] = m[k];
      }
      if (m.status === 'finished') {
        merged.status = 'finished';
        merged.homeGoals = m.homeGoals;
        merged.awayGoals = m.awayGoals;
      }
      map.set(key, merged);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      (a.round || 0) - (b.round || 0) ||
      (a.date || '').localeCompare(b.date || '') ||
      (a.time || '').localeCompare(b.time || ''),
  );
}

/** Todos los equipos que aparecen en una página (enlaces a team.aspx). */
function parseTeams(html) {
  const $ = cheerio.load(html);
  const map = new Map();
  $('a[href*="team.aspx"]').each((_, a) => {
    const t = teamFromAnchor($, a);
    if (!t.id) return;
    const prev = map.get(t.id);
    // preferimos el nombre más largo (el enlace puede mostrar sólo la abreviatura)
    if (!prev || t.name.length > prev.name.length) map.set(t.id, { ...t, code: prev && prev.code.length < t.code.length ? prev.code : t.code });
  });
  return [...map.values()];
}

const isNumeric = (c) => /^-?\d+([.,]\d+)?$/.test(String(c).trim());
const cleanPlayerName = (n) => clean(String(n || '').replace(/^\(M-\d+\)\s*/i, ''));

/** Qué columna estadística se destaca (la grande de la derecha) según el ranking. */
const MAIN_STAT = {
  scorers: { re: /^(gols?|goles|gl|g|t|tot|total)$/i },
  goalkeepers: { re: /(encaix|encaj|rebut|recib|^ge$|^gc$|^gr$|^g\.?\s?e\.?$)/i, fallbackIndex: 'second' },
};

function pickMain(stats, kind) {
  if (!stats.length) return null;
  const cfg = MAIN_STAT[kind];
  if (cfg) {
    const hit = stats.find((s) => s.label && cfg.re.test(s.label));
    if (hit) return hit;
    if (cfg.fallbackIndex === 'second' && stats.length >= 3) return stats[1];
  }
  return stats[stats.length - 1];
}

/**
 * Ranking (goleadores, porteros, tarjetas, equipos, fair play, MVP...).
 * Cada fila: { pos, name, team, teamId, shield, playerId, position, stats:[{label,value}], main, cells }
 *  - name: jugador (o equipo en rankings de equipos); el prefijo de categoría "(M-34)" se quita.
 *  - team: del enlace a team.aspx o, si no lo hay, de la ficha emergente del jugador ("Equip X - Demarcació ...").
 *  - stats: las columnas numéricas con su cabecera (las últimas columnas de la cabecera).
 */
function parseRanking(html, kind, opts = {}) {
  const tables = parseTables(html).filter((t) => !t.wrapper && (!opts.tableFilter || opts.tableFilter(t)));
  const linked = (t) => t.rows.filter((r) => r.playerId || r.teamId).length;
  const best =
    tables.filter((t) => linked(t) > 0).sort((a, b) => linked(b) - linked(a) || b.rows.length - a.rows.length)[0] ||
    tables.sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!best) return { headers: [], rows: [] };

  const anyLinked = linked(best) > 0;
  const src = anyLinked ? best.rows.filter((r) => r.playerId || r.teamId) : best.rows;

  const rows = src.map((r, idx) => {
    let team = r.teamName;
    let position = null;
    if (r.tooltip) {
      const tm = /Equip\s+(.*?)\s*-\s*Demarcaci/i.exec(r.tooltip);
      if (!team && tm && clean(tm[1]) && clean(tm[1]) !== '-') team = clean(tm[1]);
      const pm = /Demarcaci[oó]\s+(.*?)\s+(Edat|Edad)/i.exec(r.tooltip);
      if (pm && clean(pm[1]) && clean(pm[1]) !== '-') position = clean(pm[1]);
    }
    const posCell = r.cells.length > 1 && /^\d+$/.test(r.cells[0]) ? r.cells[0] : null;

    let name;
    if (r.playerId) name = cleanPlayerName((r.playerName && (r.playerName.title || r.playerName.text)) || '');
    else if (r.teamId) name = r.teamName;
    const nonNumeric = r.cells.filter((c) => !isNumeric(c));
    if (!name) name = cleanPlayerName(nonNumeric[0] || '');
    if (!team && !r.teamId) {
      // equipo como texto suelto en otra celda (distinta de la del nombre)
      const other = nonNumeric.find((c, i) => i > 0 && c !== name && cleanPlayerName(c) !== name);
      if (other) team = other;
    }

    const numeric = r.cells.filter((c, i) => isNumeric(c) && !(posCell && i === 0));
    const labels = best.headers.length >= numeric.length ? best.headers.slice(best.headers.length - numeric.length) : [];
    const stats = numeric.map((value, i) => ({ label: labels[i] || '', value }));
    return {
      pos: posCell ? Number(posCell) : idx + 1,
      name,
      team: team || null,
      teamId: r.teamId,
      shield: r.teamId ? shieldUrl(r.teamId) : null,
      playerId: r.playerId,
      position,
      stats,
      main: pickMain(stats, kind),
      cells: r.cells,
    };
  });

  const nStats = rows.reduce((m, r) => Math.max(m, r.stats.length), 0);
  const headers = best.headers.length >= nStats && nStats ? best.headers.slice(best.headers.length - nStats) : [];
  return { headers, rows };
}

/**
 * Respaldo: el top 3 de goleadores que la liga muestra en su página de situación (portada del campeonato).
 * Esa página también lleva la tabla del comité de competición (jugador + equipo + sanciones), que se
 * descarta por su cabecera ("Equip", "PP"); entre las demás se queda con la que más jugadores enlaza.
 */
function parseSituationScorers(html) {
  const onlyScorers = (t) => t.rows.some((r) => r.playerId) && !t.headers.some((h) => /^(pp|equip)/i.test(h));
  return parseRanking(html, 'scorers', { tableFilter: onlyScorers });
}

/* ======================= Ficha de equipo (team.aspx) ======================= */

const ownRows = ($, table) =>
  $(table)
    .find('tr')
    .filter((_, tr) => $(tr).closest('table')[0] === table)
    .toArray();

/** Texto de un elemento separando con espacios los textos de sus hijos ("11.10.2026" + "ALA" -> "11.10.2026 ALA"). */
function spacedText(el) {
  const parts = [];
  const walk = (n) => {
    if (n.type === 'text') parts.push(n.data);
    else if (n.children) n.children.forEach(walk);
  };
  walk(el);
  return clean(parts.join(' '));
}

/** "-" y celdas vacías cuentan como 0. */
const dashNum = (t) => (/^\d+$/.test(clean(t)) ? Number(clean(t)) : 0);
const STAT_KEYS = ['goals', 'ownGoals', 'conceded', 'yellow', 'red'];

/** Qué estadística es una columna, por su cabecera (texto o icono de tarjeta). */
function statKeyOf($, cell) {
  const t = clean($(cell).text());
  const attrs = $(cell)
    .find('img')
    .toArray()
    .map((i) => [$(i).attr('src'), $(i).attr('alt'), $(i).attr('title')].filter(Boolean).join(' '))
    .join(' ');
  if (/yellow|groga|amarill/i.test(attrs)) return 'yellow';
  // ojo: "shared" (carpeta de imágenes de la web) contiene "red"; sólo vale si no va pegado a otra letra
  if (/(?:^|[^a-z])red(?:card)?(?![a-z])|roja|vermell|rossa/i.test(attrs)) return 'red';
  if (/^(gpp|gp)$|propia|pr[òo]pia/i.test(t)) return 'ownGoals';
  if (/^gr$|rebut|recib|encaix/i.test(t)) return 'conceded';
  if (/^(g|gols?|goles?)$/i.test(t)) return 'goals';
  return null;
}

/**
 * Filas de jugadores de una tabla. Las estadísticas son las columnas a la derecha del nombre
 * (G, GPP, GR, tarjeta amarilla, tarjeta roja); se alinean con la cabecera contando desde la derecha.
 */
function buildRoster($, trs, headerTr, headerNameIdx) {
  const headerCells = headerTr ? $(headerTr).children('th,td').toArray() : [];
  const players = [];
  let k = null;
  let keys = null;
  for (const tr of trs) {
    if (tr === headerTr) continue;
    const cells = $(tr).children('th,td').toArray();
    if (!cells.length) continue;
    const link = ownLinks($, tr, 'a[href*="player.aspx"]')
      .filter((_, a) => clean($(a).text()) !== '')
      .first();
    let nameIdx = -1;
    if (link.length) nameIdx = cells.indexOf(link.closest('td,th')[0]);
    else if (headerTr) nameIdx = cells.length - (headerCells.length - headerNameIdx - 1) - 1;
    if (nameIdx < 0 || nameIdx >= cells.length - 1) continue;
    let nameRaw = link.length ? clean(link.text()) : clean($(cells[nameIdx]).text());
    if (link.length) {
      // la web recorta el nombre en pantalla; el atributo title trae el nombre completo
      const title = clean(link.attr('title'));
      const flat = (s) => s.toLowerCase().replace(/\s+/g, '');
      if (title.length >= nameRaw.length && /[A-Za-zÀ-ÿ]{2}/.test(title) && flat(title).startsWith(flat(nameRaw).slice(0, 5))) nameRaw = title;
    }
    if (!/[A-Za-zÀ-ÿ]{2}/.test(nameRaw)) continue; // fila de totales o vacía
    const kRow = cells.length - nameIdx - 1;
    if (k === null) {
      k = kRow;
      const hdr = headerCells.length >= k ? headerCells.slice(headerCells.length - k) : [];
      keys = Array.from({ length: k }, (_, i) => (hdr[i] ? statKeyOf($, hdr[i]) : null));
      // lo que no se reconozca: las dos últimas columnas son las tarjetas y, con 5, las tres primeras son G, GPP, GR
      if (k >= 2) {
        if (!keys.includes('yellow')) keys[k - 2] = keys[k - 2] || 'yellow';
        if (!keys.includes('red')) keys[k - 1] = keys[k - 1] || 'red';
      }
      if (k === 5) keys = keys.map((key, i) => key || STAT_KEYS[i]);
    }
    if (kRow !== k) continue;
    const stats = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
    keys.forEach((key, i) => {
      if (key) stats[key] = dashNum($(cells[nameIdx + 1 + i]).text());
    });
    const before = (n) => (nameIdx - n >= 0 ? clean($(cells[nameIdx - n]).text()) : '');
    const position = before(1);
    const dorsal = before(2);
    const tagM = /^\(M-(\d+)\)\s*/i.exec(nameRaw);
    players.push({
      name: cleanPlayerName(nameRaw),
      tag: tagM ? `M-${tagM[1]}` : null,
      playerId: link.length ? idFrom(link.attr('href'), 'player') : null,
      number: /^\d{1,3}$/.test(dorsal) ? Number(dorsal) : null,
      position: /[A-Za-zÀ-ÿ]{3,}/.test(position) ? position : null,
      ...stats,
    });
  }
  return players;
}

/** Cuerpo técnico: tabla con cabecera "TÉCNICO" (nombre, tipo y tarjetas). */
function parseStaff($) {
  const out = [];
  $('table').each((_, table) => {
    const trs = ownRows($, table);
    const hi = trs.findIndex((tr) =>
      $(tr)
        .children('th,td')
        .toArray()
        .some((c) => /^t[eèé]cnic/i.test(clean($(c).text()))),
    );
    if (hi < 0) return;
    for (const tr of trs.slice(hi + 1)) {
      const cells = $(tr).children('th,td').toArray();
      if (cells.length < 2) continue;
      const texts = cells.map((c) => cellText($, c));
      const cardCols = cells.length >= 4 ? 2 : 0;
      const main = texts
        .slice(0, texts.length - cardCols)
        .map((t) => t.replace(/^[A-Z]{2,4}\s+(?=\S)/, '')) // "TEC Nombre Apellido" -> "Nombre Apellido"
        .filter((t) => t && t !== '-' && !/^[A-Z]{2,4}$/.test(t));
      if (!main.length || !/[A-Za-zÀ-ÿ]{2}/.test(main[0])) continue;
      out.push({
        name: main[0],
        role: main[1] || null,
        yellow: cardCols ? dashNum(texts[texts.length - 2]) : 0,
        red: cardCols ? dashNum(texts[texts.length - 1]) : 0,
      });
    }
  });
  return out;
}

const NEXT_HEADING = /^(pr[óo]ximos partidos|propers partits)$/i;
const LAST_HEADING = /^([úu]ltimos partidos|[úu]ltims partits)$/i;
const NEXT_ROW = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}:\d{2}))?\s+([^\s-]+)\s*-\s*([^\s-]+)$/;
const LAST_ROW = /^([^\s-]+)\s+(\d+)\s*-\s*(\d+)\s+([^\s-]+)$/;

/**
 * Los recuadros laterales "PRÓXIMOS PARTIDOS" y "ÚLTIMOS PARTIDOS" de la ficha del equipo.
 * Se localizan por el texto del título y se leen las filas con el formato "11.10.2026 ALA - BOE" / "BOE 3 - 0 ICA".
 */
function parseTeamSidebar($) {
  const tags = $('*').toArray().filter((el) => el.type === 'tag');
  const headingsOf = (re) =>
    tags.filter((el) => {
      if ($(el).text().length > 40 || !re.test(spacedText(el))) return false;
      return !$(el).children().toArray().some((ch) => re.test(spacedText(ch)));
    });
  const nextH = headingsOf(NEXT_HEADING);
  const lastH = headingsOf(LAST_HEADING);

  const rowsAfter = (heading, rowRe, otherHeadings) => {
    let c = $(heading);
    let best = null;
    for (let up = 0; up < 6; up++) {
      c = c.parent();
      if (!c.length) break;
      if (otherHeadings.some((o) => $.contains(c[0], o))) break;
      best = c;
      if (c.find('a[href*="match.aspx"]').length || /\d{2}\.\d{2}\.\d{4}|\d+\s*-\s*\d+/.test(c.text())) break;
    }
    if (!best) return [];
    const found = [];
    best.find('*').each((_, el) => {
      if (el.type !== 'tag') return;
      const m = rowRe.exec(spacedText(el));
      if (!m) return;
      if ($(el).children().toArray().some((ch) => rowRe.test(spacedText(ch)))) return; // sólo el elemento más pequeño
      const a = $(el).find('a[href*="match.aspx"]').first();
      found.push({ m, matchId: a.length ? idFrom(a.attr('href'), 'match') : null });
    });
    return found;
  };

  const upcoming = [];
  for (const h of nextH) {
    for (const { m, matchId } of rowsAfter(h, NEXT_ROW, lastH)) {
      upcoming.push({ date: `${m[3]}-${m[2]}-${m[1]}`, time: m[4] ? m[4].padStart(5, '0') : null, homeCode: m[5], awayCode: m[6], matchId });
    }
    if (upcoming.length) break;
  }
  const last = [];
  for (const h of lastH) {
    for (const { m, matchId } of rowsAfter(h, LAST_ROW, nextH)) {
      last.push({ homeCode: m[1], homeGoals: Number(m[2]), awayGoals: Number(m[3]), awayCode: m[4], matchId });
    }
    if (last.length) break;
  }
  return { upcoming, last };
}

/**
 * Ficha de equipo: plantilla con goles (G), goles en propia puerta (GPP), goles recibidos (GR) y tarjetas
 * amarillas/rojas por jugador, totales, cuerpo técnico y los próximos/últimos partidos del recuadro lateral.
 */
function parseTeamPage(html) {
  const $ = cheerio.load(html);
  let roster = [];
  $('table').each((_, table) => {
    const trs = ownRows($, table);
    let headerTr = null;
    let headerNameIdx = -1;
    for (const tr of trs) {
      const cells = $(tr).children('th,td').toArray();
      const i = cells.findIndex((c) => /^(nombre|nom|jugador|jugadores|jugadors)$/i.test(clean($(c).text())));
      if (i >= 0) {
        headerTr = tr;
        headerNameIdx = i;
        break;
      }
    }
    const players = buildRoster($, trs, headerTr, headerNameIdx);
    if (players.length > roster.length) roster = players;
  });
  const totals = Object.fromEntries(STAT_KEYS.map((key) => [key, roster.reduce((s, p) => s + p[key], 0)]));
  return { roster, totals, staff: parseStaff($), ...parseTeamSidebar($) };
}

/**
 * Rankings calculados con las plantillas de todos los equipos (por si la página de rankings de la liga no
 * entrega datos): scorers (goles), cards (tarjetas) y goalkeepers (goles recibidos, sólo porteros que han encajado).
 */
function rankingFromRosters(list, kind) {
  const players = [];
  for (const { team, roster } of list) for (const p of roster) players.push({ ...p, teamInfo: team });
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  let picked = [];
  let value;
  let label;
  let extra = () => [];
  if (kind === 'scorers') {
    picked = players.filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals || byName(a, b));
    value = (p) => p.goals;
    label = 'Gols';
  } else if (kind === 'cards') {
    const total = (p) => p.yellow + p.red;
    picked = players.filter((p) => total(p) > 0).sort((a, b) => total(b) - total(a) || b.red - a.red || byName(a, b));
    value = total;
    label = 'Targetes';
    extra = (p) => [
      { label: 'Grogues', value: String(p.yellow) },
      { label: 'Vermelles', value: String(p.red) },
    ];
  } else if (kind === 'goalkeepers') {
    picked = players.filter((p) => p.conceded > 0).sort((a, b) => a.conceded - b.conceded || byName(a, b));
    value = (p) => p.conceded;
    label = 'GR';
  } else {
    return { headers: [], rows: [] };
  }
  let pos = 0;
  let prev = null;
  const rows = picked.map((p, i) => {
    if (value(p) !== prev) {
      pos = i + 1;
      prev = value(p);
    }
    return {
      pos,
      name: p.name,
      team: p.teamInfo.name,
      teamId: p.teamInfo.id,
      shield: p.teamInfo.shield,
      playerId: p.playerId,
      position: p.position,
      stats: extra(p),
      main: { label, value: String(value(p)) },
      cells: [],
    };
  });
  return { headers: [], rows };
}

/** Página con tablas variadas (comité de competición...). */
function parseGeneric(html) {
  const tables = parseTables(html)
    .filter((t) => t.rows.length && !t.wrapper)
    .map((t) => ({
      headers: t.headers.length === t.rows[0].cells.length ? t.headers : [],
      rows: t.rows.map((r) => ({ cells: r.cells, teamId: r.teamId, playerId: r.playerId })),
    }));
  const $ = cheerio.load(html);
  const title = clean($('h1,h2').first().text()) || null;
  return { title, tables };
}

/** Tarjetas de resumen de la página "Situació" (nº de equipos, partidos jugados, goles...). */
function parseSituationStats(html) {
  const tables = parseTables(html).filter((t) => !t.wrapper);
  const stats = {};
  for (const t of tables) {
    for (const r of t.rows) {
      if (r.cells.length === 2 && /^[\d.,]+$/.test(r.cells[1])) stats[r.cells[0]] = r.cells[1];
    }
  }
  return stats;
}

module.exports = {
  BASE,
  clean,
  parseTables,
  parseStandings,
  parseMatches,
  mergeMatches,
  parseTeams,
  parseRanking,
  parseSituationScorers,
  parseTeamPage,
  rankingFromRosters,
  parseGeneric,
  parseSituationStats,
  shieldUrl,
};

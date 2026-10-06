'use strict';
(() => {
  const APP_VERSION = '1.4.0';
  const view = document.getElementById('view');
  const banner = document.getElementById('banner');
  const refreshBtn = document.getElementById('refresh');
  const tabs = [...document.querySelectorAll('.tabs button')];

  const RANKINGS = [
    ['scorers', 'Goleadores'],
    ['goalkeepers', 'Porteros'],
    ['teams', 'Equipos'],
    ['cards', 'Tarjetas'],
    ['fairplay', 'Fair play'],
    ['mvp', 'MVP'],
    ['mvt', 'MVT'],
  ];

  const state = { tab: 'standings', ranking: 'scorers', round: null, team: null };

  /* ---------- utilidades ---------- */
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = (s) => /^-?\d+([.,]\d+)?$/.test(String(s).trim());
  const shield = (url) =>
    url ? `<img class="shield" src="${esc(url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="shield"></span>';

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const fmtUpdated = (iso) => {
    if (!iso) return '';
    return `Actualizado ${new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  };

  function showBanner(msg, error = false) {
    banner.hidden = !msg;
    banner.className = 'banner' + (error ? ' error' : '');
    banner.textContent = msg || '';
  }

  async function getJson(url, force = false) {
    const res = await fetch(url + (force ? (url.includes('?') ? '&' : '?') + 't=' + Date.now() : ''));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `Error ${res.status}`);
    if (data._cache === 'stale') showBanner('No se pudo actualizar desde la web de la liga: se muestran los últimos datos guardados.');
    return data;
  }

  /* ---------- vistas ---------- */
  function renderStandings(d) {
    if (!d.rows.length) return '<p class="empty">Todavía no hay clasificación publicada.</p>';
    const headers = d.headers.length ? d.headers : [];
    const head = headers.length
      ? `<tr><th>#</th><th class="team">Equipo</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`
      : `<tr><th>#</th><th class="team">Equipo</th><th>Pts</th></tr>`;
    const ptsIdx = headers.findIndex((h) => /^(pt|pts|punts)$/i.test(h));
    const rows = d.rows
      .map((r) => {
        const vals = r.values.length ? r.values : [''];
        const cells = vals
          .map((v, i) => `<td class="${i === (ptsIdx >= 0 ? ptsIdx : vals.length - 1) ? 'pts' : ''}">${esc(v)}</td>`)
          .join('');
        return `<tr class="clickable ${r.pos <= 3 ? 'top3' : ''}" data-team="${esc(r.teamId)}"><td class="pos">${r.pos}</td><td class="team"><div class="team-cell">${shield(r.shield)}<span>${esc(r.team)}</span></div></td>${cells}</tr>`;
      })
      .join('');
    const note = d.partial ? '<p class="updated">Clasificación resumida (solo puntos).</p>' : '';
    return `<div class="card scroll-x"><table class="table">${head}${rows}</table></div>${note}<p class="updated">${fmtUpdated(d.updatedAt)}</p>`;
  }

  function matchHtml(m) {
    const finished = m.status === 'finished' && m.homeGoals != null;
    const score = finished
      ? `<div class="score">${m.homeGoals} - ${m.awayGoals}</div>`
      : `<div class="score pending">${esc(m.time || 'vs')}</div>`;
    const flag = m.status === 'postponed' ? '<span class="pill">Aplazado</span>' : m.status === 'suspended' ? '<span class="pill">Suspendido</span>' : '';
    return `<div class="match">
      <div class="when"><span>${esc(fmtDate(m.date))}${m.time && finished ? ' · ' + esc(m.time) : ''}</span><span>${flag} ${m.field ? esc(m.field.code) : ''}</span></div>
      <div class="t clickable" data-team="${esc(m.home.id)}">${shield(m.home.shield)}<span>${esc(m.home.name)}</span></div>
      ${score}
      <div class="t away clickable" data-team="${esc(m.away.id)}">${shield(m.away.shield)}<span>${esc(m.away.name)}</span></div>
    </div>`;
  }

  function defaultRound(d) {
    // la primera jornada con partidos pendientes; si todo está jugado, la última
    const pending = d.matches.find((m) => m.status === 'pending' && m.round != null);
    return pending ? pending.round : d.rounds[d.rounds.length - 1];
  }

  function renderCalendar(d) {
    if (!d.matches.length) return '<p class="empty">No hay partidos publicados.</p>';
    if (state.round == null || !d.rounds.includes(state.round)) state.round = defaultRound(d);
    const i = d.rounds.indexOf(state.round);
    const list = d.matches.filter((m) => m.round === state.round);
    const options = d.rounds.map((r) => `<option value="${r}" ${r === state.round ? 'selected' : ''}>Jornada ${r}</option>`).join('');
    return `<div class="round-nav">
        <button data-round="${d.rounds[i - 1]}" ${i <= 0 ? 'disabled' : ''} aria-label="Jornada anterior">‹</button>
        <select id="round-select" aria-label="Jornada">${options}</select>
        <button data-round="${d.rounds[i + 1]}" ${i >= d.rounds.length - 1 ? 'disabled' : ''} aria-label="Jornada siguiente">›</button>
      </div>
      <div class="card">${list.map(matchHtml).join('')}</div>
      <p class="updated">${d.rounds.length} jornadas disponibles · ${fmtUpdated(d.updatedAt)}</p>`;
  }

  /** Etiqueta bajo la cifra principal: la de la cabecera de la liga, o una descriptiva según el ranking. */
  function mainLabel(kind, main) {
    if (kind === 'scorers') return 'goles';
    if (kind === 'goalkeepers') return 'encajados';
    if (kind === 'cards') return 'tarjetas';
    return main && main.label ? labelEs(main.label) : '';
  }

  const LABELS_ES = { Gols: 'Goles', Targetes: 'Tarjetas', Grogues: 'Amarillas', Vermelles: 'Rojas' };
  const labelEs = (l) => LABELS_ES[l] || l;

  function renderRankingRows(d) {
    if (!d.rows.length) {
      return '<p class="empty">Todavía no hay datos en este ranking.</p>';
    }
    const rows = d.rows
      .map((r) => {
        // lo que va debajo del nombre: equipo y demarcación
        const sub = [r.team, r.position].filter(Boolean).join(' · ');
        // el resto de estadísticas con su nombre (PJ 3 · Mitjana 1,00); las que no tienen cabecera se omiten
        const extra = (r.stats || [])
          .filter((s) => s !== r.main && !(r.main && s.label === r.main.label && s.value === r.main.value))
          .filter((s) => s.label)
          .map((s) => `${esc(labelEs(s.label))} ${esc(s.value)}`)
          .join(' · ');
        const value = r.main ? esc(r.main.value) : '';
        const label = esc(mainLabel(d.kind, r.main));
        const clickable = r.teamId ? ` clickable" data-team="${esc(r.teamId)}` : '';
        return `<div class="row rank${clickable}">
          <div class="n">${esc(r.pos)}</div>${r.shield ? shield(r.shield) : '<span class="shield"></span>'}
          <div class="grow"><b>${esc(r.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${extra ? `<small class="stats">${extra}</small>` : ''}</div>
          <div class="val">${value}${label ? `<small>${label}</small>` : ''}</div>
        </div>`;
      })
      .join('');
    const notes = [];
    if (d.partial) notes.push(`La liga no publica el ranking completo en esta página: se muestran solo los ${d.rows.length} primeros de su portada.`);
    const cov = d.coverage;
    if (d.source === 'plantillas' && cov && cov.teamsWithRoster < cov.teamsTotal) {
      notes.push(`Se han podido leer ${cov.teamsWithRoster} de ${cov.teamsTotal} plantillas, así que puede que falten jugadores.`);
    }
    if (d.note) notes.push(d.note);
    const note = notes.map((n) => `<div class="banner inline">${esc(n)}</div>`).join('');
    return `${note}<div class="card">${rows}</div><p class="updated">${fmtUpdated(d.updatedAt)}</p>`;
  }

  function renderTeams(d) {
    if (!d.teams.length) return '<p class="empty">No se han encontrado equipos.</p>';
    return `<div class="card">${d.teams
      .map(
        (t) =>
          `<button class="team-btn" data-team="${esc(t.id)}"><div class="row">${shield(t.shield)}<div class="grow">${esc(t.name)}</div><div class="n">›</div></div></button>`,
      )
      .join('')}</div><p class="updated">${d.teams.length} equipos · ${fmtUpdated(d.updatedAt)}</p>`;
  }

  /** Una fila de partido desde el punto de vista de un equipo. */
  function teamMatchHtml(m, teamId) {
    const home = m.home.id === teamId;
    const rival = home ? m.away : m.home;
    const finished = m.status === 'finished' && m.homeGoals != null;
    let right = `<div class="score pending">${esc(m.time || '—')}</div>`;
    let badge = '';
    if (finished) {
      const gf = home ? m.homeGoals : m.awayGoals;
      const gc = home ? m.awayGoals : m.homeGoals;
      const r = gf > gc ? 'G' : gf < gc ? 'P' : 'E';
      badge = `<span class="res res-${r}">${r === 'G' ? 'Ganado' : r === 'P' ? 'Perdido' : 'Empate'}</span>`;
      right = `<div class="score">${m.homeGoals} - ${m.awayGoals}</div>`;
    } else if (m.status === 'postponed') badge = '<span class="pill">Aplazado</span>';
    else if (m.status === 'suspended') badge = '<span class="pill">Suspendido</span>';
    const when = [m.round != null ? `J${m.round}` : '', fmtDate(m.date), finished ? m.time : '', m.field ? m.field.code : '']
      .filter(Boolean)
      .join(' · ');
    return `<div class="match team-match">
      <div class="when"><span>${esc(when)}</span><span>${badge}</span></div>
      <div class="t${rival.id ? ` clickable" data-team="${esc(rival.id)}` : ''}">${shield(rival.shield)}<span><small class="ha">${home ? 'Local' : 'Visitante'}</small>${esc(rival.name)}</span></div>
      ${right}
    </div>`;
  }

  /** Plantilla: goles (G) y tarjetas de cada jugador, tal como los publica la ficha del equipo en la web de la liga. */
  function renderSquad(sq) {
    if (!sq || !sq.roster || !sq.roster.length) return '';
    const players = sq.roster
      .slice()
      .sort((a, b) => b.goals - a.goals || b.yellow + b.red - (a.yellow + a.red) || a.name.localeCompare(b.name, 'es'));
    const showGPP = players.some((p) => p.ownGoals > 0);
    const showGR = players.some((p) => p.conceded > 0);
    const cell = (v) => (v ? `<span class="v">${esc(v)}</span>` : '<span class="v zero">–</span>');
    const cols = (p) =>
      `${cell(p.goals)}${showGPP ? cell(p.ownGoals) : ''}${showGR ? cell(p.conceded) : ''}${cell(p.yellow)}${cell(p.red)}`;
    const head = `<div class="squad-row head"><span class="nm">Jugador</span><span class="v" title="Goles">G</span>${
      showGPP ? '<span class="v" title="Goles en propia puerta">GPP</span>' : ''
    }${showGR ? '<span class="v" title="Goles recibidos">GR</span>' : ''}<span class="v" title="Amarillas"><i class="cd cd-y"></i></span><span class="v" title="Rojas"><i class="cd cd-r"></i></span></div>`;
    const rows = players
      .map((p) => {
        const meta = [p.number != null ? `#${p.number}` : '', p.position || ''].filter(Boolean).join(' · ');
        return `<div class="squad-row"><span class="nm">${esc(p.name)}${meta ? `<small>${esc(meta)}</small>` : ''}</span>${cols(p)}</div>`;
      })
      .join('');
    const t = sq.totals;
    const foot = t ? `<div class="squad-row foot"><span class="nm">Total</span>${cols(t)}</div>` : '';
    return `<div class="card squad"><h2>Plantilla · ${players.length} jugadores</h2>${head}${rows}${foot}</div>`;
  }

  function renderTeamDetail(d) {
    const t = d.team;
    let standing = '';
    if (d.standing) {
      const bits = d.standing.values
        .map((v, i) => `${d.standing.headers[i] ? esc(d.standing.headers[i]) + ' ' : ''}<b>${esc(v)}</b>`)
        .join(' · ');
      standing = `<p class="team-sub">${d.standing.pos}º en la clasificación${bits ? ' · ' + bits : ''}</p>`;
    }
    const staff = d.squad && d.squad.staff ? d.squad.staff : [];
    const coach = staff.find((x) => /entrenador|entrenador|t[eè]cnic/i.test(x.role || '')) || staff[0];
    if (coach) standing += `<p class="team-sub">Entrenador: <b>${esc(coach.name)}</b></p>`;
    const up = d.upcoming.length
      ? `<div class="card"><h2>Próximos partidos</h2>${d.upcoming.map((m) => teamMatchHtml(m, t.id)).join('')}</div>`
      : '<div class="card"><h2>Próximos partidos</h2><p class="empty small">No hay más partidos publicados.</p></div>';
    const res = d.results.length
      ? `<div class="card"><h2>Resultados</h2>${d.results.map((m) => teamMatchHtml(m, t.id)).join('')}</div>`
      : '';
    const cov = d.coverage || {};
    const partial = cov.roundsTotal && cov.roundsRead < cov.roundsTotal;
    const note = partial
      ? `<div class="banner inline">Solo se han podido leer ${cov.roundsRead} de ${cov.roundsTotal} jornadas del calendario de la liga, por eso puede que falten partidos.</div>`
      : '';
    return `<button class="back" id="back">‹ Volver</button>
      <div class="team-head">${shield(t.shield)}<div><h2>${esc(t.name)}</h2>${standing}</div></div>
      ${note}${up}${res}${renderSquad(d.squad)}<p class="updated">${fmtUpdated(d.updatedAt)}</p>`;
  }

  function genericTable(t) {
    const head = t.headers.length ? `<tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` : '';
    const body = t.rows.map((r) => `<tr>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
    return `<div class="card scroll-x"><table class="table">${head}${body}</table></div>`;
  }

  function renderGeneric(d, empty) {
    const useful = (d.tables || []).filter((t) => t.rows.length);
    if (!useful.length) return `<p class="empty">${empty}</p>`;
    return useful.map(genericTable).join('') + `<p class="updated">${fmtUpdated(d.updatedAt)}</p>`;
  }

  /* ---------- carga ---------- */
  async function load(force = false) {
    refreshBtn.classList.add('spin');
    showBanner('');
    const tab = state.tab;
    if (!view.innerHTML || force === 'switch') view.innerHTML = '<p class="loading">Cargando…</p>';
    try {
      if (state.team) {
        view.innerHTML = renderTeamDetail(await getJson(`/api/teams/${state.team}`, force === true));
        window.scrollTo(0, 0);
      } else if (tab === 'standings') {
        view.innerHTML = renderStandings(await getJson('/api/standings', force === true));
      } else if (tab === 'calendar') {
        const d = await getJson('/api/calendar', force === true);
        view.innerHTML = renderCalendar(d);
        view._cal = d;
      } else if (tab === 'rankings') {
        const chips = RANKINGS.map(
          ([k, label]) => `<button class="chip" data-rank="${k}" aria-pressed="${k === state.ranking}">${label}</button>`,
        ).join('');
        view.innerHTML = `<div class="chips">${chips}</div><div id="rank-body"><p class="loading">Cargando…${['scorers', 'goalkeepers', 'cards'].includes(state.ranking) ? '<br><small>La primera vez se leen las plantillas de todos los equipos y puede tardar unos segundos.</small>' : ''}</p></div>`;
        const d = await getJson(`/api/rankings/${state.ranking}`, force === true);
        const body = document.getElementById('rank-body');
        if (body && state.tab === 'rankings') body.innerHTML = renderRankingRows(d);
      } else if (tab === 'teams') {
        view.innerHTML = renderTeams(await getJson('/api/teams', force === true));
      } else if (tab === 'committee') {
        view.innerHTML = renderGeneric(await getJson('/api/committee', force === true), 'No hay sanciones publicadas.');
      }
    } catch (err) {
      view.innerHTML = '<p class="empty">No se pudo cargar la información.</p>';
      showBanner(`${err.message}. Comprueba tu conexión y pulsa ↻ para reintentar.`, true);
    } finally {
      refreshBtn.classList.remove('spin');
    }
  }

  function setTab(tab) {
    state.tab = tab;
    state.team = null;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    window.scrollTo(0, 0);
    load('switch');
  }

  /* ---------- eventos ---------- */
  tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  refreshBtn.addEventListener('click', () => load(true));

  view.addEventListener('click', (e) => {
    const roundBtn = e.target.closest('[data-round]');
    if (roundBtn && !roundBtn.disabled && view._cal) {
      state.round = Number(roundBtn.dataset.round);
      view.innerHTML = renderCalendar(view._cal);
      return;
    }
    const rank = e.target.closest('[data-rank]');
    if (rank) {
      state.ranking = rank.dataset.rank;
      load('switch');
      return;
    }
    const team = e.target.closest('[data-team]');
    if (team) {
      state.team = team.dataset.team;
      load('switch');
      return;
    }
    if (e.target.closest('#back')) {
      state.team = null;
      load('switch');
    }
  });
  view.addEventListener('change', (e) => {
    if (e.target.id === 'round-select' && view._cal) {
      state.round = Number(e.target.value);
      view.innerHTML = renderCalendar(view._cal);
    }
  });

  const verEl = document.getElementById('ver');
  if (verEl) verEl.textContent = 'v' + APP_VERSION;

  if ('serviceWorker' in navigator) {
    // si una versión nueva de la app toma el control, recarga una vez para mostrarla
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) {
        reloaded = true;
        location.reload();
      }
    });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  load('switch');
})();

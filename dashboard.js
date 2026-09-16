/**
 * js/dashboard.js
 * Owns the DOM: renders whichever tab is active, wires every filter
 * (including the Daily/Weekly/Monthly period tabs, which set the date
 * range so KPIs, tables AND charts across the whole dashboard move
 * together), sorting, CSV export, and the periodic auto-refresh.
 */
(function () {
  'use strict';

  var D = window.DashData;
  var C = window.DashCharts;

  var appState = {
    tab: 'overview',
    teamSubTab: 'all',
    sort: { agents: { col: 'points', dir: 'desc' }, teams: { col: 'points', dir: 'desc' }, teamAgents: { col: 'points', dir: 'desc' }, states: { col: 'sales', dir: 'desc' }, campaigns: { col: 'conversion', dir: 'desc' } }
  };

  // ───────────────────────── FORMAT HELPERS ─────────────────────────

  function fmtInt(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  function fmtPct(n) { return (n || 0).toFixed(1) + '%'; }
  function fmtDuration(sec) {
    sec = Math.round(sec || 0);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISODate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // ── Central Time → Pakistan Time conversion ──
  // The call center's "Time Frame" / "Timestamp" hours are US Central
  // Time. Pakistan has no DST (always UTC+5); Chicago is UTC-5 (CDT,
  // roughly Mar-Nov) or UTC-6 (CST, roughly Nov-Mar), so the gap is 10
  // or 11 hours depending on the time of year. This reads the real
  // offset from the browser's timezone database instead of hard-coding
  // one, so it stays correct across the DST changeover.
  function chicagoIsDST(date) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' }).formatToParts(date);
    var tz = parts.find(function (p) { return p.type === 'timeZoneName'; });
    return tz && tz.value === 'CDT';
  }
  function pakOffsetFromCentral(date) { return chicagoIsDST(date) ? 10 : 11; }

  function hour12Parts(h) {
    var ampm = h < 12 ? 'AM' : 'PM';
    var hh = h % 12; if (hh === 0) hh = 12;
    return { hh: hh, ampm: ampm };
  }
  function pakRangeLabel(centralHour, offset) {
    var start = (centralHour + offset + 24) % 24;
    var end = (start + 1) % 24;
    var a = hour12Parts(start), b = hour12Parts(end);
    return a.ampm === b.ampm ? (a.hh + '-' + b.hh + a.ampm) : (a.hh + a.ampm + '-' + b.hh + b.ampm);
  }
  function centralRangeLabel(h) { return pad2(h) + '-' + pad2((h + 1) % 24) + 'CT'; }

  function missedColorClass(pct) {
    if (pct < 5) return 'cell-good';
    if (pct < 8) return 'cell-ok';
    if (pct < 11) return 'cell-warn';
    if (pct < 15) return 'cell-caution';
    if (pct < 25) return 'cell-bad';
    return 'cell-critical';
  }

  // Renders the ops-style Sales / Answered / Missed / Missed % grid,
  // one column per hour, labeled in both Pakistan time and US Central
  // time — the call center's own shift runs 6AM Central onward, so
  // columns start there and wrap around rather than starting at
  // midnight.
  function buildHourlyPerformanceTable(hourly, refDate) {
    var offset = pakOffsetFromCentral(refDate || new Date());
    var order = []; for (var i = 0; i < 24; i++) order.push((6 + i) % 24);
    var byHour = {}; hourly.forEach(function (h) { byHour[h.hour] = h; });

    var totals = { calls: 0, answered: 0, sales: 0, missed: 0 };
    hourly.forEach(function (h) { totals.calls += h.calls; totals.answered += h.answered; totals.sales += h.sales; totals.missed += h.missed; });
    var totalMissedPct = totals.calls ? (totals.missed / totals.calls) * 100 : 0;

    var pakRow = '<tr><td class="row-label">Pak Time</td>' + order.map(function (h) { return '<th>' + pakRangeLabel(h, offset) + '</th>'; }).join('') + '<th class="row-total-hdr">—</th></tr>';
    var ctRow = '<tr><td class="row-label row-label-sub">Central Time</td>' + order.map(function (h) { return '<th class="ct-hdr">' + centralRangeLabel(h) + '</th>'; }).join('') + '<th class="row-total-hdr">Total</th></tr>';

    function metricRow(label, key, bold) {
      var cells = order.map(function (h) {
        var v = (byHour[h] && byHour[h][key]) || 0;
        return '<td' + (bold ? ' class="cell-strong"' : '') + '>' + fmtInt(v) + '</td>';
      }).join('');
      var total = totals[key === 'calls' ? 'calls' : key];
      return '<tr><td class="row-label">' + label + '</td>' + cells + '<td class="cell-strong cell-total">' + fmtInt(total) + '</td></tr>';
    }

    var missedPctCells = order.map(function (h) {
      var pct = (byHour[h] && byHour[h].missedPct) || 0;
      return '<td class="' + missedColorClass(pct) + '">' + fmtPct(pct) + '</td>';
    }).join('');
    var missedPctRow = '<tr><td class="row-label">Missed %</td>' + missedPctCells + '<td class="' + missedColorClass(totalMissedPct) + ' cell-total">' + fmtPct(totalMissedPct) + '</td></tr>';

    return '<table class="data-table hourly-perf-table">' +
      '<thead>' + pakRow + ctRow + '</thead>' +
      '<tbody>' +
      metricRow('Sales', 'sales', true) +
      metricRow('Answered', 'answered') +
      metricRow('Missed', 'missed') +
      missedPctRow +
      '</tbody></table>';
  }

  function pageMeta(tab) {
    var map = {
      overview: ['Overview', 'Sales performance summary'],
      agents: ['Agent Rankings', 'Leaderboard by points, calls and sales'],
      teams: ['Teams', 'Team-level performance comparison'],
      states: ['State Analytics', 'Where sales are landing geographically'],
      campaigns: ['Campaigns', 'Conversion by campaign'],
      insights: ['Insights', 'Auto-generated takeaways for the current filters'],
      api: ['API Setup', 'Connect the dashboard to your Google Sheet']
    };
    return map[tab] || ['Dashboard', ''];
  }

  // ───────────────────────── LAYOUT PIECES ─────────────────────────

  function kpiCard(label, value, help) {
    return '<div class="kpi-card"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + '</div>' +
      '<div class="kpi-help">' + help + '</div></div>';
  }

  function chartCard(id, title, canvasHeight, extraClass) {
    return '<div class="chart-card ' + (extraClass || '') + '"><div class="chart-card-title">' + title + '</div>' +
      '<div class="chart-card-body" style="height:' + (canvasHeight || 260) + 'px"><canvas id="' + id + '"></canvas></div></div>';
  }

  function tableCard(title, tableHtml, id) {
    return '<div class="table-card" id="' + id + '"><div class="table-card-title">' + title + '</div><div class="table-scroll">' + tableHtml + '</div></div>';
  }

  function sortIcon(active, dir) {
    if (!active) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  }

  // ───────────────────────── RENDER: OVERVIEW ─────────────────────────

  function renderOverview(calls, sales) {
    var k = D.computeKpis(calls, sales);
    var trend = D.computeTrend(calls, sales, D.getFilters().period);
    var hourly = D.computeHourlyCombined(calls, sales);
    var breakdown = D.computeCallResultBreakdown(calls);

    var html = '<div class="kpi-grid">' +
      kpiCard('Total Calls', fmtInt(k.totalCalls), 'Every inbound call row in range, all campaigns.') +
      kpiCard('Answer Rate', fmtPct(k.answerRate), '% of calls where Call Result = Answered.') +
      kpiCard('Total Sales', fmtInt(k.totalSales), 'Rows in the sales sheet — one per processed order.') +
      kpiCard('Conversion Rate', fmtPct(k.conversionRate), 'Sales ÷ Answered calls.') +
      kpiCard('Total RGUs', fmtInt(k.totalRgus), "Sum of the RGU's column.") +
      kpiCard('Total Points', fmtInt(k.totalPoints), 'Sum of Total Points — incentive scoreboard.') +
      kpiCard('Avg. Talk Time', fmtDuration(k.avgTalk), 'Average talk duration on answered calls.') +
      kpiCard('Active Agents', fmtInt(k.activeAgents), 'Distinct agents with ≥1 sale in range.') +
      '</div>';

    html += '<div class="chart-row">' +
      chartCard('chartTrend', 'Calls vs. Sales (' + D.getFilters().period + ')', 280, 'chart-card--wide') +
      '</div>';

    html += '<div class="chart-row chart-row--2">' +
      chartCard('chartCallResult', 'Call Result Breakdown', 260) +
      chartCard('chartHourly', 'Calls & Sales by Hour', 260) +
      '</div>';

    // ── Detailed breakdown tables (counts + % share) ──
    var teamRows = D.computeTeamTable(calls, sales).sort(function (a, b) { return b.points - a.points; });
    var campaignRows = D.computeCampaignTable(calls, sales).sort(function (a, b) { return b.calls - a.calls; });
    var stateRows = D.computeStateTable(sales);

    html += '<div class="chart-row chart-row--2">' +
      tableCard('Call Result Breakdown', buildCallResultBreakdownTable(breakdown, k.totalCalls), 'callResultBreakdownCard') +
      tableCard('Team Share of Sales & Points', buildTeamBreakdownTable(teamRows, k.totalSales, k.totalPoints), 'teamBreakdownCard') +
      '</div>';

    html += '<div class="chart-row chart-row--2">' +
      tableCard('Campaign Share of Calls & Sales', buildCampaignBreakdownTable(campaignRows, k.totalCalls, k.totalSales), 'campaignBreakdownCard') +
      tableCard('State Share of Sales', buildStateBreakdownTable(stateRows, k.totalSales), 'stateBreakdownCard') +
      '</div>';

    html += '<div class="chart-row">' +
      tableCard('Hourly Performance — Pak Time / Central Time', buildHourlyPerformanceTable(hourly, new Date((D.getFilters().dateEnd || toISODate(new Date())) + 'T12:00:00')), 'hourlyBreakdownCard') +
      '</div>';

    document.getElementById('contentArea').innerHTML = html;

    var labels = trend.map(function (t) { return t.key; });
    C.line('chartTrend', labels, [
      { label: 'Calls', data: trend.map(function (t) { return t.calls; }) },
      { label: 'Answered', data: trend.map(function (t) { return t.answered; }) },
      { label: 'Sales', data: trend.map(function (t) { return t.sales; }) }
    ]);

    var brLabels = Object.keys(breakdown);
    C.doughnut('chartCallResult', brLabels, brLabels.map(function (l) { return breakdown[l]; }));

    C.bar('chartHourly', hourly.map(function (h) { return h.hour + ':00'; }), [
      { label: 'Calls', data: hourly.map(function (h) { return h.calls; }) },
      { label: 'Sales', data: hourly.map(function (h) { return h.sales; }) }
    ]);
  }

  // ───────────────────────── RENDER: AGENTS ─────────────────────────

  function pctOf(part, whole) { return whole ? (part / whole) * 100 : 0; }

  function buildCallResultBreakdownTable(breakdown, totalCalls) {
    var rows = Object.keys(breakdown).map(function (k2) { return { label: k2, count: breakdown[k2] }; })
      .sort(function (a, b) { return b.count - a.count; });
    var body = rows.map(function (r) {
      return '<tr><td>' + r.label + '</td><td>' + fmtInt(r.count) + '</td><td><strong>' + fmtPct(pctOf(r.count, totalCalls)) + '</strong></td></tr>';
    }).join('');
    body += '<tr class="total-row"><td>Total</td><td>' + fmtInt(totalCalls) + '</td><td>100.0%</td></tr>';
    return '<table class="data-table"><thead><tr><th>Call Result</th><th>Calls</th><th>% of Total</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function buildTeamBreakdownTable(teamRows, totalSales, totalPoints) {
    var body = teamRows.map(function (r) {
      return '<tr><td>' + r.team + '</td><td>' + fmtInt(r.sales) + '</td><td>' + fmtPct(pctOf(r.sales, totalSales)) +
        '</td><td>' + fmtInt(r.points) + '</td><td><strong>' + fmtPct(pctOf(r.points, totalPoints)) + '</strong></td></tr>';
    }).join('');
    return '<table class="data-table"><thead><tr><th>Team</th><th>Sales</th><th>% of Sales</th><th>Points</th><th>% of Points</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function buildCampaignBreakdownTable(campaignRows, totalCalls, totalSales) {
    var body = campaignRows.map(function (r) {
      return '<tr><td>' + r.campaign + '</td><td>' + fmtInt(r.calls) + '</td><td>' + fmtPct(pctOf(r.calls, totalCalls)) +
        '</td><td>' + fmtInt(r.sales) + '</td><td><strong>' + fmtPct(pctOf(r.sales, totalSales)) + '</strong></td></tr>';
    }).join('');
    return '<table class="data-table"><thead><tr><th>Campaign</th><th>Calls</th><th>% of Calls</th><th>Sales</th><th>% of Sales</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function buildStateBreakdownTable(stateRows, totalSales) {
    var body = stateRows.map(function (r) {
      return '<tr><td>' + r.state + '</td><td>' + fmtInt(r.sales) + '</td><td><strong>' + fmtPct(pctOf(r.sales, totalSales)) +
        '</strong></td><td>' + fmtInt(r.rgus) + '</td><td>' + fmtInt(r.points) + '</td></tr>';
    }).join('');
    return '<table class="data-table"><thead><tr><th>State</th><th>Sales</th><th>% of Sales</th><th>RGUs</th><th>Points</th></tr></thead><tbody>' + body + '</tbody></table>';
  }



  function renderAgents(calls, sales) {
    var rows = D.computeAgentTable(calls, sales);
    var sort = appState.sort.agents;
    rows.sort(function (a, b) { return sort.dir === 'asc' ? a[sort.col] - b[sort.col] : b[sort.col] - a[sort.col]; });

    var top10 = rows.slice().sort(function (a, b) { return b.points - a.points; }).slice(0, 10);

    var cols = [
      ['agent', 'Agent'], ['calls', 'Calls'], ['answered', 'Answered'], ['sales', 'Sales'],
      ['rgus', 'RGUs'], ['conversion', 'Conv. %'], ['avgTalk', 'Avg. Talk'], ['points', 'Points']
    ];
    var thead = '<thead><tr>' + cols.map(function (c) {
      return '<th data-col="' + c[0] + '" class="sortable">' + c[1] + sortIcon(sort.col === c[0], sort.dir) + '</th>';
    }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function (r) {
      return '<tr><td>' + r.agent + '</td><td>' + fmtInt(r.calls) + '</td><td>' + fmtInt(r.answered) + '</td><td>' + fmtInt(r.sales) +
        '</td><td>' + fmtInt(r.rgus) + '</td><td>' + fmtPct(r.conversion) + '</td><td>' + fmtDuration(r.avgTalk) + '</td><td><strong>' + fmtInt(r.points) + '</strong></td></tr>';
    }).join('') + '</tbody>';

    var html = '<div class="chart-row">' + chartCard('chartTopAgents', 'Top 10 by Points', 300, 'chart-card--wide') + '</div>' +
      tableCard('Agent Leaderboard (click a header to sort)', '<table class="data-table" id="agentsTable">' + thead + tbody + '</table>', 'agentsTableCard');

    document.getElementById('contentArea').innerHTML = html;

    C.bar('chartTopAgents', top10.map(function (a) { return a.agent; }), [{ label: 'Points', data: top10.map(function (a) { return a.points; }) }], { horizontal: true });

    document.querySelectorAll('#agentsTable th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-col');
        if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.col = col; sort.dir = 'desc'; }
        renderAgents(D.getFilteredCalls(), D.getFilteredSales());
      });
    });
  }

  // ───────────────────────── RENDER: TEAMS ─────────────────────────

  function renderTeams(calls, sales) {
    var teamNames = D.computeTeamTable(calls, sales).map(function (t) { return t.team; }).sort();
    var active = appState.teamSubTab;
    if (active !== 'all' && teamNames.indexOf(active) === -1) active = 'all';

    var pillsHtml = '<div class="team-pills">' +
      '<button class="team-pill' + (active === 'all' ? ' active' : '') + '" data-team="all">All Teams</button>' +
      teamNames.map(function (t) {
        return '<button class="team-pill' + (active === t ? ' active' : '') + '" data-team="' + t + '">' + t + '</button>';
      }).join('') + '</div>';

    document.getElementById('contentArea').innerHTML = pillsHtml + '<div id="teamsBody"></div>';

    document.querySelectorAll('.team-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        appState.teamSubTab = btn.getAttribute('data-team');
        renderTeams(D.getFilteredCalls(), D.getFilteredSales());
      });
    });

    if (active === 'all') renderTeamsOverview(calls, sales);
    else renderTeamDetail(active, calls, sales);
  }

  function renderTeamsOverview(calls, sales) {
    var rows = D.computeTeamTable(calls, sales);
    var sort = appState.sort.teams;
    rows.sort(function (a, b) { return sort.dir === 'asc' ? a[sort.col] - b[sort.col] : b[sort.col] - a[sort.col]; });

    var cols = [['team', 'Team'], ['calls', 'Calls'], ['answered', 'Answered'], ['sales', 'Sales'], ['rgus', 'RGUs'], ['conversion', 'Conv. %'], ['points', 'Points']];
    var thead = '<thead><tr>' + cols.map(function (c) { return '<th data-col="' + c[0] + '" class="sortable">' + c[1] + sortIcon(sort.col === c[0], sort.dir) + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function (r) {
      return '<tr class="clickable-row" data-team="' + r.team + '"><td>' + r.team + '</td><td>' + fmtInt(r.calls) + '</td><td>' + fmtInt(r.answered) + '</td><td>' + fmtInt(r.sales) + '</td><td>' + fmtInt(r.rgus) + '</td><td>' + fmtPct(r.conversion) + '</td><td><strong>' + fmtInt(r.points) + '</strong></td></tr>';
    }).join('') + '</tbody>';

    var maxSales = Math.max.apply(null, rows.map(function (r) { return r.sales; }).concat([1]));
    var maxRgus = Math.max.apply(null, rows.map(function (r) { return r.rgus; }).concat([1]));
    var maxPoints = Math.max.apply(null, rows.map(function (r) { return r.points; }).concat([1]));

    var html = '<div class="chart-row">' + chartCard('chartTeamRadar', 'Team Comparison (Sales / RGUs / Points, % of best)', 340, 'chart-card--wide') + '</div>' +
      tableCard('Team Summary — click a row or a pill above to drill into that team lead', '<table class="data-table" id="teamsTable">' + thead + tbody + '</table>', 'teamsTableCard');

    document.getElementById('teamsBody').innerHTML = html;

    C.radar('chartTeamRadar', ['Sales', 'RGUs', 'Points'], rows.map(function (r) {
      return {
        label: r.team,
        data: [
          Math.round((r.sales / maxSales) * 100),
          Math.round((r.rgus / maxRgus) * 100),
          Math.round((r.points / maxPoints) * 100)
        ]
      };
    }));

    document.querySelectorAll('#teamsTable th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-col');
        if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.col = col; sort.dir = 'desc'; }
        renderTeamsOverview(D.getFilteredCalls(), D.getFilteredSales());
      });
    });
    document.querySelectorAll('#teamsTable .clickable-row').forEach(function (tr) {
      tr.addEventListener('click', function () {
        appState.teamSubTab = tr.getAttribute('data-team');
        renderTeams(D.getFilteredCalls(), D.getFilteredSales());
      });
    });
  }

  // Per-team-lead detail view: that team's own KPIs plus the full
  // roster of agents working under them, so a team lead can open their
  // own tab and see exactly their people's numbers.
  function renderTeamDetail(team, calls, sales) {
    var map = D.getAgentTeamMap();
    var teamCalls = calls.filter(function (c) { return map[c['Agent Name']] === team; });
    var teamSales = sales.filter(function (s) { return s.Team === team; });
    var k = D.computeKpis(teamCalls, teamSales);

    var agentRows = D.computeAgentTable(teamCalls, teamSales);
    var sort = appState.sort.teamAgents || (appState.sort.teamAgents = { col: 'points', dir: 'desc' });
    agentRows.sort(function (a, b) { return sort.dir === 'asc' ? a[sort.col] - b[sort.col] : b[sort.col] - a[sort.col]; });

    var html = '<div class="team-detail-hdr"><h2>' + team + '</h2><span class="team-detail-count">' + agentRows.length + ' agent' + (agentRows.length === 1 ? '' : 's') + '</span></div>';

    html += '<div class="kpi-grid">' +
      kpiCard('Calls', fmtInt(k.totalCalls), 'All calls handled by this team\'s agents.') +
      kpiCard('Answer Rate', fmtPct(k.answerRate), '% answered.') +
      kpiCard('Sales', fmtInt(k.totalSales), 'Orders closed by this team.') +
      kpiCard('Conversion', fmtPct(k.conversionRate), 'Sales ÷ Answered calls.') +
      kpiCard('RGUs', fmtInt(k.totalRgus), "Sum of RGU's.") +
      kpiCard('Points', fmtInt(k.totalPoints), 'Team incentive total.') +
      '</div>';

    html += '<div class="chart-row">' + chartCard('chartTeamAgents', 'Agents by Points', 280, 'chart-card--wide') + '</div>';

    var cols = [['agent', 'Agent'], ['calls', 'Calls'], ['answered', 'Answered'], ['sales', 'Sales'], ['rgus', 'RGUs'], ['conversion', 'Conv. %'], ['avgTalk', 'Avg. Talk'], ['points', 'Points']];
    var thead = '<thead><tr>' + cols.map(function (c) { return '<th data-col="' + c[0] + '" class="sortable">' + c[1] + sortIcon(sort.col === c[0], sort.dir) + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + (agentRows.length ? agentRows.map(function (r) {
      return '<tr><td>' + r.agent + '</td><td>' + fmtInt(r.calls) + '</td><td>' + fmtInt(r.answered) + '</td><td>' + fmtInt(r.sales) +
        '</td><td>' + fmtInt(r.rgus) + '</td><td>' + fmtPct(r.conversion) + '</td><td>' + fmtDuration(r.avgTalk) + '</td><td><strong>' + fmtInt(r.points) + '</strong></td></tr>';
    }).join('') : '<tr><td colspan="8" style="color:var(--ink-40)">No agents under this team in the current filters.</td></tr>') + '</tbody>';

    html += tableCard('Agent Roster', '<table class="data-table" id="teamAgentsTable">' + thead + tbody + '</table>', 'teamAgentsTableCard');

    document.getElementById('teamsBody').innerHTML = html;

    var top = agentRows.slice().sort(function (a, b) { return b.points - a.points; }).slice(0, 12);
    C.bar('chartTeamAgents', top.map(function (a) { return a.agent; }), [{ label: 'Points', data: top.map(function (a) { return a.points; }) }], { horizontal: true });

    document.querySelectorAll('#teamAgentsTable th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-col');
        if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.col = col; sort.dir = 'desc'; }
        renderTeamDetail(team, D.getFilteredCalls(), D.getFilteredSales());
      });
    });
  }

  // ───────────────────────── RENDER: STATES ─────────────────────────

  function renderStates(calls, sales) {
    var rows = D.computeStateTable(sales);
    var sort = appState.sort.states;
    rows.sort(function (a, b) { return sort.dir === 'asc' ? a[sort.col] - b[sort.col] : b[sort.col] - a[sort.col]; });

    var top = rows.slice(0, 12);
    var cols = [['state', 'State'], ['sales', 'Sales'], ['rgus', 'RGUs'], ['points', 'Points']];
    var thead = '<thead><tr>' + cols.map(function (c) { return '<th data-col="' + c[0] + '" class="sortable">' + c[1] + sortIcon(sort.col === c[0], sort.dir) + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function (r) {
      return '<tr><td>' + r.state + '</td><td>' + fmtInt(r.sales) + '</td><td>' + fmtInt(r.rgus) + '</td><td><strong>' + fmtInt(r.points) + '</strong></td></tr>';
    }).join('') + '</tbody>';

    var html = '<div class="chart-row">' + chartCard('chartStates', 'Top States by Sales', 320, 'chart-card--wide') + '</div>' +
      tableCard('All States', '<table class="data-table" id="statesTable">' + thead + tbody + '</table>', 'statesTableCard');

    document.getElementById('contentArea').innerHTML = html;
    C.bar('chartStates', top.map(function (r) { return r.state; }), [{ label: 'Sales', data: top.map(function (r) { return r.sales; }) }], { horizontal: true });

    document.querySelectorAll('#statesTable th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-col');
        if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.col = col; sort.dir = 'desc'; }
        renderStates(D.getFilteredCalls(), D.getFilteredSales());
      });
    });
  }

  // ───────────────────────── RENDER: CAMPAIGNS ─────────────────────────

  function renderCampaigns(calls, sales) {
    var rows = D.computeCampaignTable(calls, sales);
    var sort = appState.sort.campaigns;
    rows.sort(function (a, b) { return sort.dir === 'asc' ? a[sort.col] - b[sort.col] : b[sort.col] - a[sort.col]; });

    var cols = [['campaign', 'Campaign'], ['calls', 'Calls'], ['answered', 'Answered'], ['sales', 'Sales'], ['rgus', 'RGUs'], ['conversion', 'Conv. %']];
    var thead = '<thead><tr>' + cols.map(function (c) { return '<th data-col="' + c[0] + '" class="sortable">' + c[1] + sortIcon(sort.col === c[0], sort.dir) + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function (r) {
      return '<tr><td>' + r.campaign + '</td><td>' + fmtInt(r.calls) + '</td><td>' + fmtInt(r.answered) + '</td><td>' + fmtInt(r.sales) + '</td><td>' + fmtInt(r.rgus) + '</td><td><strong>' + fmtPct(r.conversion) + '</strong></td></tr>';
    }).join('') + '</tbody>';

    var html = '<div class="chart-row">' + chartCard('chartCampaigns', 'Answered vs. Sales by Campaign', 300, 'chart-card--wide') + '</div>' +
      tableCard('Campaign Summary', '<table class="data-table" id="campaignsTable">' + thead + tbody + '</table>', 'campaignsTableCard');

    document.getElementById('contentArea').innerHTML = html;

    var byCampaign = rows.slice().sort(function (a, b) { return b.calls - a.calls; });
    C.bar('chartCampaigns', byCampaign.map(function (r) { return r.campaign; }), [
      { label: 'Answered', data: byCampaign.map(function (r) { return r.answered; }) },
      { label: 'Sales', data: byCampaign.map(function (r) { return r.sales; }) }
    ]);

    document.querySelectorAll('#campaignsTable th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-col');
        if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.col = col; sort.dir = 'desc'; }
        renderCampaigns(D.getFilteredCalls(), D.getFilteredSales());
      });
    });
  }

  // ───────────────────────── RENDER: INSIGHTS ─────────────────────────

  function renderInsights(calls, sales) {
    var hourly = D.computeHourly(calls);
    var insights = D.computeInsights(calls, sales, hourly);
    var mixes = D.computeMixes(sales);

    var html = '<div class="insights-list">' + (insights.length ?
      insights.map(function (t) { return '<div class="insight-item"><span class="insight-dot"></span>' + t + '</div>'; }).join('') :
      '<div class="insight-item insight-empty">Not enough data in this filter/date range to generate insights yet.</div>') + '</div>';

    html += '<div class="chart-row chart-row--3">' +
      chartCard('chartProvider', 'Provider Mix', 240) +
      chartCard('chartServices', 'Service Mix', 240) +
      chartCard('chartInstall', 'Install Type Mix', 240) +
      '</div>';

    document.getElementById('contentArea').innerHTML = html;

    C.doughnut('chartProvider', Object.keys(mixes.provider), Object.values(mixes.provider));
    C.doughnut('chartServices', Object.keys(mixes.services), Object.values(mixes.services));
    C.doughnut('chartInstall', Object.keys(mixes.installType), Object.values(mixes.installType));
  }

  // ───────────────────────── RENDER: API SETUP ─────────────────────────

  function renderApiSetup() {
    var url = D.getApiUrl();
    var range = D.getDataRange();
    var raw = D.getRaw();

    var html = '<div class="api-setup">' +
      '<div class="api-card">' +
      '<h3>Connection</h3>' +
      '<p class="api-help">Paste the Apps Script Web App URL you got when you deployed <code>apps-script/Code.gs</code> (Deploy → New deployment → Web app → Execute as Me → Access: Anyone).</p>' +
      '<div class="api-row">' +
      '<input type="text" id="apiUrlInput" class="api-input" placeholder="https://script.google.com/macros/s/AKfycb.../exec" value="' + (url || '') + '" />' +
      '<select id="apiDaysSelect" class="slicer-select">' +
      [30, 60, 90, 180, 365].map(function (d) { return '<option value="' + d + '"' + (d === 90 ? ' selected' : '') + '>' + d + ' days of history</option>'; }).join('') +
      '</select>' +
      '<button class="btn-primary" id="apiSaveBtn">Save & Connect</button>' +
      '</div>' +
      '<p class="api-status">Status: <strong>' + (raw.isDemo ? 'Demo data' : 'Live data') + '</strong>' +
      (range ? ' · Loaded rows span ' + range.start + ' → ' + range.end : '') + '</p>' +
      '</div>' +
      '<div class="api-card">' +
      '<h3>Apps Script code</h3>' +
      '<p class="api-help">The backend script that turns your Google Sheet into this JSON API. Paste it into Extensions → Apps Script in your Sheet.</p>' +
      '<button class="btn-secondary" id="viewGasBtn">View the Apps Script code</button>' +
      '</div>' +
      '</div>';

    document.getElementById('contentArea').innerHTML = html;

    document.getElementById('apiSaveBtn').addEventListener('click', function () {
      var val = document.getElementById('apiUrlInput').value.trim();
      D.setApiUrl(val);
      showToast(val ? 'Saved — connecting…' : 'Cleared — showing demo data.');
      refreshAll();
    });

    document.getElementById('viewGasBtn').addEventListener('click', openGasModal);
  }

  function openGasModal() {
    var modal = document.getElementById('gasModal');
    var block = document.getElementById('gasCodeBlock');
    block.textContent = 'Loading…';
    modal.style.display = 'flex';
    fetch('apps-script/Code.gs').then(function (r) { return r.text(); }).then(function (t) {
      block.textContent = t;
    }).catch(function () {
      block.textContent = 'Could not load apps-script/Code.gs — open it directly from the project files.';
    });
  }

  // ───────────────────────── TAB SWITCHING ─────────────────────────

  function render() {
    var calls = D.getFilteredCalls();
    var sales = D.getFilteredSales();
    switch (appState.tab) {
      case 'overview': renderOverview(calls, sales); break;
      case 'agents': renderAgents(calls, sales); break;
      case 'teams': renderTeams(calls, sales); break;
      case 'states': renderStates(calls, sales); break;
      case 'campaigns': renderCampaigns(calls, sales); break;
      case 'insights': renderInsights(calls, sales); break;
      case 'api': renderApiSetup(); break;
    }
  }

  function switchTab(tab) {
    appState.tab = tab;
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-tab') === tab);
    });
    var meta = pageMeta(tab);
    document.getElementById('pageTitle').textContent = meta[0];
    document.querySelector('.page-sub').textContent = meta[1];
    document.querySelector('.slicer-bar').style.display = tab === 'api' ? 'none' : '';
    render();
  }

  // ───────────────────────── FILTER BAR WIRING ─────────────────────────

  function populateSelect(id, values, currentValue) {
    var el = document.getElementById(id);
    var first = el.options[0]; // "All ..." option
    el.innerHTML = '';
    el.appendChild(first);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      el.appendChild(opt);
    });
    el.value = values.indexOf(currentValue) !== -1 ? currentValue : '';
  }

  function refreshFilterOptions() {
    var opts = D.getFilterOptions();
    var f = D.getFilters();
    populateSelect('filterTeam', opts.teams, f.team);
    populateSelect('filterCampaign', opts.campaigns, f.campaign);
    populateSelect('filterState', opts.states, f.state);
    populateSelect('filterAgent', opts.agents, f.agent);
    populateSelect('filterCallResult', opts.callResults, f.callResult);
  }

  function readFiltersFromUI() {
    D.setFilters({
      dateStart: document.getElementById('dateStart').value,
      dateEnd: document.getElementById('dateEnd').value,
      team: document.getElementById('filterTeam').value,
      campaign: document.getElementById('filterCampaign').value,
      state: document.getElementById('filterState').value,
      agent: document.getElementById('filterAgent').value,
      callResult: document.getElementById('filterCallResult').value,
      search: document.getElementById('globalSearch').value
    });
  }

  // Daily/Weekly/Monthly buttons drive the date range itself, so every
  // KPI, table and chart on every tab — not just the Overview trend
  // line — recomputes for that window.
  function applyPeriodPreset(period) {
    var today = new Date();
    var start, end;
    if (period === 'daily') {
      start = end = today;
    } else if (period === 'weekly') {
      var day = (today.getDay() + 6) % 7; // 0 = Monday
      start = new Date(today); start.setDate(today.getDate() - day);
      end = new Date(start); end.setDate(start.getDate() + 6);
    } else {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }
    document.getElementById('dateStart').value = toISODate(start);
    document.getElementById('dateEnd').value = toISODate(end);
    D.setFilters({ period: period, dateStart: toISODate(start), dateEnd: toISODate(end) });
  }

  function wireFilterBar() {
    document.querySelectorAll('.period-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.period-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        applyPeriodPreset(btn.getAttribute('data-period'));
        render();
      });
    });

    ['dateStart', 'dateEnd', 'filterTeam', 'filterCampaign', 'filterState', 'filterAgent', 'filterCallResult'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () { readFiltersFromUI(); render(); });
    });
    var searchTimer;
    document.getElementById('globalSearch').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { readFiltersFromUI(); render(); }, 250);
    });

    document.getElementById('clearFilters').addEventListener('click', function () {
      ['filterTeam', 'filterCampaign', 'filterState', 'filterAgent', 'filterCallResult'].forEach(function (id) { document.getElementById(id).value = ''; });
      document.getElementById('globalSearch').value = '';
      readFiltersFromUI();
      render();
    });

    document.getElementById('exportCsvBtn').addEventListener('click', exportCurrentTabCsv);
  }

  // ───────────────────────── CSV EXPORT ─────────────────────────

  function toCsv(rows, headers) {
    var lines = [headers.join(',')];
    rows.forEach(function (r) {
      lines.push(headers.map(function (h) {
        var v = r[h] === undefined || r[h] === null ? '' : String(r[h]);
        if (v.indexOf(',') !== -1 || v.indexOf('"') !== -1) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(','));
    });
    return lines.join('\n');
  }

  function downloadCsv(filename, csv) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportCurrentTabCsv() {
    var calls = D.getFilteredCalls(), sales = D.getFilteredSales();
    var map = {
      overview: function () { return { rows: sales, headers: ['Date', 'Campaign', 'Agent Name', 'Team', 'State', 'Provider', 'Services', "RGU's", 'Total Points'], name: 'sales' }; },
      agents: function () { return { rows: D.computeAgentTable(calls, sales), headers: ['agent', 'calls', 'answered', 'sales', 'rgus', 'conversion', 'avgTalk', 'points'], name: 'agent-leaderboard' }; },
      teams: function () { return { rows: D.computeTeamTable(calls, sales), headers: ['team', 'calls', 'answered', 'sales', 'rgus', 'conversion', 'points'], name: 'team-summary' }; },
      states: function () { return { rows: D.computeStateTable(sales), headers: ['state', 'sales', 'rgus', 'points'], name: 'state-summary' }; },
      campaigns: function () { return { rows: D.computeCampaignTable(calls, sales), headers: ['campaign', 'calls', 'answered', 'sales', 'rgus', 'conversion'], name: 'campaign-summary' }; },
      insights: function () { return { rows: sales, headers: ['Date', 'Campaign', 'Agent Name', 'Team', 'State', 'Provider', 'Services', "RGU's", 'Total Points'], name: 'sales' }; }
    };
    var fn = map[appState.tab];
    if (!fn) { showToast('Nothing to export on this tab.'); return; }
    var out = fn();
    if (!out.rows.length) { showToast('No rows match the current filters.'); return; }
    downloadCsv('simply-connect-' + out.name + '-' + toISODate(new Date()) + '.csv', toCsv(out.rows, out.headers));
    showToast('Exported ' + out.rows.length + ' rows.');
  }

  // ───────────────────────── TOAST / STATUS ─────────────────────────

  var toastTimer;
  function showToast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3000);
  }

  function updateStatusPill(result) {
    var dot = document.querySelector('#dataStatus .status-dot');
    var text = document.querySelector('#dataStatus .status-text');
    if (result && result.error) {
      dot.className = 'status-dot error';
      text.textContent = 'Connection failed';
    } else if (D.isDemo()) {
      dot.className = 'status-dot demo';
      text.textContent = 'Demo data';
    } else {
      dot.className = 'status-dot live';
      text.textContent = 'Live data';
    }
    var range = D.getDataRange();
    var rangeEl = document.getElementById('dataRangeText');
    rangeEl.textContent = range ? (range.start + ' → ' + range.end) : '—';
  }

  // ───────────────────────── INIT / REFRESH ─────────────────────────

  function refreshAll() {
    var days = (window.DASH_CONFIG && window.DASH_CONFIG.DEFAULT_DAYS) || 90;
    return D.load(days).then(function (result) {
      refreshFilterOptions();
      updateStatusPill(result);
      render();
      return result;
    });
  }

  function init() {
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        switchTab(el.getAttribute('data-tab'));
      });
    });

    document.getElementById('sidebarToggle').addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    document.getElementById('refreshBtn').addEventListener('click', function () {
      showToast('Refreshing…');
      refreshAll();
    });

    document.getElementById('gasModalClose').addEventListener('click', function () {
      document.getElementById('gasModal').style.display = 'none';
    });
    document.getElementById('gasModal').addEventListener('click', function (e) {
      if (e.target.id === 'gasModal') document.getElementById('gasModal').style.display = 'none';
    });

    wireFilterBar();
    var meta0 = pageMeta('overview');
    document.getElementById('pageTitle').textContent = meta0[0];
    document.querySelector('.page-sub').textContent = meta0[1];
    applyPeriodPreset('daily'); // sets today's date into the range inputs + filters

    refreshAll();

    // Auto-refresh every 5 minutes so new rows added to the Sheet show
    // up without anyone needing to reload the page.
    setInterval(function () { refreshAll(); }, 5 * 60 * 1000);
  }

  document.addEventListener('DOMContentLoaded', init);

})();

/**
 * js/data.js
 * Fetches the live API (or falls back to demo data until one is
 * configured), holds the raw + filtered rows, and computes every
 * number the dashboard displays. Nothing in here touches the DOM.
 */
(function (global) {
  'use strict';

  var RAW = { calls: [], sales: [], meta: {}, generatedAt: null, isDemo: true };
  var STATE = {
    period: 'daily',           // daily | weekly | monthly
    dateStart: null,
    dateEnd: null,
    team: '', campaign: '', state: '', agent: '', callResult: '', search: ''
  };

  // ───────────────────────── API URL ─────────────────────────

  function getApiUrl() {
    var configured = (global.DASH_CONFIG && global.DASH_CONFIG.API_URL) || '';
    var saved = localStorage.getItem('dash_api_url') || '';
    return (configured || saved || '').trim();
  }

  function setApiUrl(url) {
    localStorage.setItem('dash_api_url', (url || '').trim());
  }

  // ───────────────────────── FETCH ─────────────────────────

  function load(days) {
    var url = getApiUrl();
    if (!url) {
      buildDemoData();
      return Promise.resolve({ ok: true, demo: true });
    }

    var sep = url.indexOf('?') === -1 ? '?' : '&';
    var full = url + sep + 'days=' + (days || 90);

    return fetch(full)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (json.error) throw new Error(json.error);
        RAW.calls = json.calls || [];
        RAW.sales = json.sales || [];
        RAW.meta = json.meta || {};
        RAW.generatedAt = json.generatedAt || new Date().toISOString();
        RAW.isDemo = false;
        return { ok: true, demo: false };
      })
      .catch(function (err) {
        console.error('API fetch failed, falling back to demo data:', err);
        buildDemoData();
        return { ok: false, demo: true, error: err.message };
      });
  }

  // ───────────────────────── DEMO DATA ─────────────────────────
  // Only used until a real API URL is configured, so the dashboard
  // never looks broken on first load. Shaped exactly like the real
  // API response.

  function buildDemoData() {
    var teams = ['Team Hassan', 'Team Areeb', 'Team Noor', 'Team Wajahat', 'Team Yousif', 'Team Wireless'];
    var campaigns = ['Group 44', 'Group 48', 'Group 50', 'Group 55', 'Group 56'];
    var states = ['TX', 'FL', 'CA', 'GA', 'IN', 'TN', 'NC', 'IL', 'MI', 'AL', 'SC', 'KY'];
    var providers = ['Xfinity', 'At&t', 'DirectTV', 'T Mobile', 'Frontier'];
    var services = ['Internet', 'TV', 'Mobility', 'Internet, Phone'];
    var results = ['Answered', 'Answered', 'Answered', 'Answered', 'Overflow - Time', 'Abandoned', 'Stranded', 'Transferred'];
    var agentsByTeam = {};
    teams.forEach(function (t, ti) {
      agentsByTeam[t] = [];
      for (var i = 0; i < 4; i++) agentsByTeam[t].push('Agent ' + (ti * 4 + i + 1));
    });

    var calls = [], sales = [];
    var today = new Date();
    for (var d = 29; d >= 0; d--) {
      var day = new Date(today); day.setDate(day.getDate() - d);
      var dateStr = day.toISOString().slice(0, 10);

      teams.forEach(function (team) {
        agentsByTeam[team].forEach(function (agent) {
          var campaign = campaigns[Math.floor(Math.random() * campaigns.length)];
          var callsToday = 8 + Math.floor(Math.random() * 20);
          for (var c = 0; c < callsToday; c++) {
            var result = results[Math.floor(Math.random() * results.length)];
            calls.push({
              'Call Center Name': campaign,
              Campaign: campaign,
              Date: dateStr,
              'Time Frame': (8 + Math.floor(Math.random() * 9)) + '-' + (9 + Math.floor(Math.random() * 9)) + 'CT',
              'Agent Name': agent,
              'Call Result': result,
              'Wait Time': Math.floor(Math.random() * 90),
              'Talk Time': result === 'Answered' ? 60 + Math.floor(Math.random() * 500) : 0,
              'Hold Time': Math.floor(Math.random() * 40),
              'Wrap Up Time': Math.floor(Math.random() * 60),
              'Disposition Codes': null
            });
          }
          if (Math.random() < 0.35) {
            var rgus = 1 + Math.floor(Math.random() * 2);
            var saleHour = 8 + Math.floor(Math.random() * 11); // 8am-6pm shift spread
            var saleMin = Math.floor(Math.random() * 60);
            sales.push({
              Date: dateStr,
              Timestamp: dateStr + ' ' + String(saleHour).padStart(2, '0') + ':' + String(saleMin).padStart(2, '0') + ':00',
              Campaign: campaign,
              'gRPCampaign Number': campaign,
              'Agent Name': agent,
              'Closer Name': agent,
              Team: team,
              State: states[Math.floor(Math.random() * states.length)],
              Provider: providers[Math.floor(Math.random() * providers.length)],
              Services: services[Math.floor(Math.random() * services.length)],
              "RGU's": rgus,
              'Installation Type': 'Standard',
              'Total Points': rgus * (2 + Math.floor(Math.random() * 4))
            });
          }
        });
      });
    }

    RAW.calls = calls;
    RAW.sales = sales;
    RAW.meta = { callsRows: calls.length, salesRows: sales.length };
    RAW.generatedAt = new Date().toISOString();
    RAW.isDemo = true;
  }

  // ───────────────────────── FILTER STATE ─────────────────────────

  function setFilters(patch) {
    Object.assign(STATE, patch);
  }
  function getFilters() { return STATE; }

  // Calls Data has no Team/State field of its own. We back-fill Team
  // by joining on Agent Name against the sales rows (an agent who
  // closed a sale under "Team Areeb" is treated as Team Areeb for
  // their calls too). State has no equivalent on the calls side at
  // all, so the State filter intentionally only narrows sales-based
  // numbers, exactly like Call Result only narrows calls-based ones.
  var agentTeamMap = {};

  function rebuildAgentTeamMap() {
    agentTeamMap = {};
    RAW.sales.forEach(function (s) {
      if (s['Agent Name'] && s.Team) agentTeamMap[s['Agent Name']] = s.Team;
      if (s['Closer Name'] && s.Team) agentTeamMap[s['Closer Name']] = s.Team;
    });
  }

  function getAgentTeamMap() {
    rebuildAgentTeamMap();
    return Object.assign({}, agentTeamMap);
  }

  function getFilteredCalls() {
    rebuildAgentTeamMap();
    return RAW.calls.filter(function (row) {
      var d = row.Date;
      if (STATE.dateStart && d < STATE.dateStart) return false;
      if (STATE.dateEnd && d > STATE.dateEnd) return false;
      if (STATE.campaign && row.Campaign !== STATE.campaign) return false;
      if (STATE.agent && row['Agent Name'] !== STATE.agent) return false;
      if (STATE.callResult && row['Call Result'] !== STATE.callResult) return false;
      if (STATE.team) {
        var team = agentTeamMap[row['Agent Name']];
        if (team !== STATE.team) return false;
      }
      if (STATE.search) {
        var hay = (row['Agent Name'] + ' ' + row.Campaign + ' ' + row['Call Result']).toLowerCase();
        if (hay.indexOf(STATE.search.toLowerCase()) === -1) return false;
      }
      return true;
    });
  }

  function getFilteredSales() {
    return RAW.sales.filter(function (row) {
      var d = row.Date;
      if (STATE.dateStart && d < STATE.dateStart) return false;
      if (STATE.dateEnd && d > STATE.dateEnd) return false;
      if (STATE.team && row.Team !== STATE.team) return false;
      if (STATE.campaign && row.Campaign !== STATE.campaign) return false;
      if (STATE.state && row.State !== STATE.state) return false;
      if (STATE.agent && row['Agent Name'] !== STATE.agent && row['Closer Name'] !== STATE.agent) return false;
      if (STATE.search) {
        var hay = Object.values(row).join(' ').toLowerCase();
        if (hay.indexOf(STATE.search.toLowerCase()) === -1) return false;
      }
      return true;
    });
  }

  // ───────────────────────── FILTER OPTIONS ─────────────────────────

  function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort();
  }

  function getFilterOptions() {
    return {
      teams: uniqueSorted(RAW.sales.map(function (r) { return r.Team; })),
      campaigns: uniqueSorted(RAW.calls.map(function (r) { return r.Campaign; }).concat(RAW.sales.map(function (r) { return r.Campaign; }))),
      states: uniqueSorted(RAW.sales.map(function (r) { return r.State; })),
      agents: uniqueSorted(RAW.calls.map(function (r) { return r['Agent Name']; }).concat(RAW.sales.map(function (r) { return r['Agent Name']; }))),
      callResults: uniqueSorted(RAW.calls.map(function (r) { return r['Call Result']; }))
    };
  }

  function getDataRange() {
    var dates = RAW.calls.map(function (r) { return r.Date; }).concat(RAW.sales.map(function (r) { return r.Date; })).filter(Boolean).sort();
    if (!dates.length) return null;
    return { start: dates[0], end: dates[dates.length - 1] };
  }

  // ───────────────────────── KPIs ─────────────────────────

  function sum(rows, field) {
    return rows.reduce(function (acc, r) { return acc + (Number(r[field]) || 0); }, 0);
  }

  function computeKpis(calls, sales) {
    var answered = calls.filter(function (c) { return c['Call Result'] === 'Answered'; });
    var totalCalls = calls.length;
    var answerRate = totalCalls ? (answered.length / totalCalls) * 100 : 0;
    var totalSales = sales.length;
    var conversionRate = answered.length ? (totalSales / answered.length) * 100 : 0;
    var totalRgus = sum(sales, "RGU's");
    var totalPoints = sum(sales, 'Total Points');
    var avgTalk = answered.length ? sum(answered, 'Talk Time') / answered.length : 0;
    var activeAgents = new Set(sales.map(function (s) { return s['Agent Name'] || s['Closer Name']; }).filter(Boolean)).size;

    return {
      totalCalls: totalCalls,
      answerRate: answerRate,
      totalSales: totalSales,
      conversionRate: conversionRate,
      totalRgus: totalRgus,
      totalPoints: totalPoints,
      avgTalk: avgTalk,
      activeAgents: activeAgents
    };
  }

  // ───────────────────────── TREND (period-aware) ─────────────────────────

  function periodKey(dateStr, period) {
    var d = new Date(dateStr + 'T00:00:00');
    if (period === 'daily') return dateStr;
    if (period === 'monthly') return dateStr.slice(0, 7); // YYYY-MM
    // weekly: key by the Monday of that week
    var day = (d.getDay() + 6) % 7; // 0 = Monday
    var monday = new Date(d);
    monday.setDate(d.getDate() - day);
    return monday.toISOString().slice(0, 10);
  }

  function computeTrend(calls, sales, period) {
    var buckets = {};
    function bucket(key) {
      if (!buckets[key]) buckets[key] = { key: key, calls: 0, answered: 0, sales: 0 };
      return buckets[key];
    }
    calls.forEach(function (c) {
      var b = bucket(periodKey(c.Date, period));
      b.calls++;
      if (c['Call Result'] === 'Answered') b.answered++;
    });
    sales.forEach(function (s) {
      bucket(periodKey(s.Date, period)).sales++;
    });
    var keys = Object.keys(buckets).sort();
    return keys.map(function (k) { return buckets[k]; });
  }

  function computeHourly(calls) {
    var hours = {};
    for (var h = 0; h < 24; h++) hours[h] = 0;
    calls.forEach(function (c) {
      var tf = c['Time Frame'];
      var h = null;
      if (tf && /^\d+/.test(tf)) h = parseInt(tf, 10);
      if (h !== null && h >= 0 && h < 24) hours[h]++;
    });
    return Object.keys(hours).sort(function (a, b) { return a - b; }).map(function (h) { return { hour: h, count: hours[h] }; });
  }

  // Hour-of-day is read from the "Timestamp" column (the moment each
  // sale row was submitted). Sales Data has no other per-row time
  // field, so this is the only reliable source for "which hour did
  // this sale happen in."
  function extractHour(timestamp) {
    if (!timestamp || typeof timestamp !== 'string') return null;
    var m = timestamp.match(/\s(\d{1,2}):\d{2}:\d{2}$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    return (h >= 0 && h < 24) ? h : null;
  }

  function computeHourlySales(sales) {
    var hours = {};
    for (var h = 0; h < 24; h++) hours[h] = 0;
    sales.forEach(function (s) {
      var h = extractHour(s['Timestamp']);
      if (h !== null) hours[h]++;
    });
    return Object.keys(hours).sort(function (a, b) { return a - b; }).map(function (h) { return { hour: h, count: hours[h] }; });
  }

  // Combined calls+sales-per-hour, used for both the Overview chart
  // and its matching breakdown table.
  // Single-pass per-hour aggregation of both calls and sales — used by
  // the Overview trend chart and by the Pak/Central-time performance
  // table. "Missed" = every non-Answered call (Abandoned, Overflow,
  // Stranded, Transferred, Escaped all lumped together), same as the
  // 2-bucket Sales/Answered/Missed layout ops teams already track.
  function computeHourlyCombined(calls, sales) {
    var buckets = {};
    for (var h = 0; h < 24; h++) buckets[h] = { hour: h, calls: 0, answered: 0, sales: 0 };
    calls.forEach(function (c) {
      var tf = c['Time Frame'];
      var h = tf && /^\d+/.test(tf) ? parseInt(tf, 10) : null;
      if (h === null || h < 0 || h > 23) return;
      buckets[h].calls++;
      if (c['Call Result'] === 'Answered') buckets[h].answered++;
    });
    sales.forEach(function (s) {
      var h = extractHour(s['Timestamp']);
      if (h === null) return;
      buckets[h].sales++;
    });
    return Object.keys(buckets).sort(function (a, b) { return a - b; }).map(function (h) {
      var b = buckets[h];
      var missed = b.calls - b.answered;
      return {
        hour: b.hour, calls: b.calls, answered: b.answered, sales: b.sales,
        missed: missed, missedPct: b.calls ? (missed / b.calls) * 100 : 0
      };
    });
  }

  function computeCallResultBreakdown(calls) {
    var out = {};
    calls.forEach(function (c) {
      var r = c['Call Result'] || 'Unknown';
      out[r] = (out[r] || 0) + 1;
    });
    return out;
  }

  // ───────────────────────── AGENT / TEAM / STATE / CAMPAIGN ─────────────────────────

  function computeAgentTable(calls, sales) {
    var byAgent = {};
    function get(name) {
      if (!byAgent[name]) byAgent[name] = { agent: name, calls: 0, answered: 0, sales: 0, rgus: 0, talkSum: 0, points: 0 };
      return byAgent[name];
    }
    calls.forEach(function (c) {
      var name = c['Agent Name']; if (!name) return;
      var a = get(name);
      a.calls++;
      if (c['Call Result'] === 'Answered') { a.answered++; a.talkSum += Number(c['Talk Time']) || 0; }
    });
    sales.forEach(function (s) {
      var name = s['Agent Name'] || s['Closer Name']; if (!name) return;
      var a = get(name);
      a.sales++;
      a.rgus += Number(s["RGU's"]) || 0;
      a.points += Number(s['Total Points']) || 0;
    });
    return Object.values(byAgent).map(function (a) {
      return {
        agent: a.agent,
        calls: a.calls,
        answered: a.answered,
        sales: a.sales,
        rgus: a.rgus,
        conversion: a.answered ? (a.sales / a.answered) * 100 : 0,
        avgTalk: a.answered ? a.talkSum / a.answered : 0,
        points: a.points
      };
    });
  }

  function computeTeamTable(calls, sales) {
    var byTeam = {};
    function get(name) {
      if (!byTeam[name]) byTeam[name] = { team: name, calls: 0, answered: 0, sales: 0, rgus: 0, points: 0 };
      return byTeam[name];
    }
    rebuildAgentTeamMap();
    calls.forEach(function (c) {
      var team = agentTeamMap[c['Agent Name']];
      if (!team) return;
      var t = get(team);
      t.calls++;
      if (c['Call Result'] === 'Answered') t.answered++;
    });
    sales.forEach(function (s) {
      var team = s.Team; if (!team) return;
      var t = get(team);
      t.sales++;
      t.rgus += Number(s["RGU's"]) || 0;
      t.points += Number(s['Total Points']) || 0;
    });
    return Object.values(byTeam).map(function (t) {
      return Object.assign(t, { conversion: t.answered ? (t.sales / t.answered) * 100 : 0 });
    });
  }

  function computeStateTable(sales) {
    var byState = {};
    function get(name) {
      if (!byState[name]) byState[name] = { state: name, sales: 0, rgus: 0, points: 0 };
      return byState[name];
    }
    sales.forEach(function (s) {
      if (!s.State) return;
      var st = get(s.State);
      st.sales++;
      st.rgus += Number(s["RGU's"]) || 0;
      st.points += Number(s['Total Points']) || 0;
    });
    return Object.values(byState).sort(function (a, b) { return b.sales - a.sales; });
  }

  function computeCampaignTable(calls, sales) {
    var byCampaign = {};
    function get(name) {
      if (!byCampaign[name]) byCampaign[name] = { campaign: name, calls: 0, answered: 0, sales: 0, rgus: 0 };
      return byCampaign[name];
    }
    calls.forEach(function (c) {
      var name = c.Campaign; if (!name) return;
      var cp = get(name);
      cp.calls++;
      if (c['Call Result'] === 'Answered') cp.answered++;
    });
    sales.forEach(function (s) {
      var name = s.Campaign; if (!name) return;
      var cp = get(name);
      cp.sales++;
      cp.rgus += Number(s["RGU's"]) || 0;
    });
    return Object.values(byCampaign).map(function (c) {
      return Object.assign(c, { conversion: c.answered ? (c.sales / c.answered) * 100 : 0 });
    });
  }

  function computeMixes(sales) {
    function mix(field) {
      var out = {};
      sales.forEach(function (s) {
        var v = s[field] || 'Unknown';
        out[v] = (out[v] || 0) + 1;
      });
      return out;
    }
    return {
      provider: mix('Provider'),
      services: mix('Services'),
      installType: mix('Installation Type')
    };
  }

  function computeInsights(calls, sales, hourly) {
    var insights = [];
    var agents = computeAgentTable(calls, sales).sort(function (a, b) { return b.points - a.points; });
    var teams = computeTeamTable(calls, sales).sort(function (a, b) { return b.points - a.points; });
    var states = computeStateTable(sales);
    var campaigns = computeCampaignTable(calls, sales).sort(function (a, b) { return b.conversion - a.conversion; });

    if (agents.length && agents[0].points > 0) insights.push(agents[0].agent + ' leads the board with ' + agents[0].points + ' points from ' + agents[0].sales + ' sales.');
    if (teams.length && teams[0].points > 0) insights.push(teams[0].team + ' is the top-performing team this period, with ' + teams[0].points + ' points.');
    if (states.length) insights.push(states[0].state + ' is the strongest state, with ' + states[0].sales + ' sales.');
    if (campaigns.length) {
      var best = campaigns.filter(function (c) { return c.answered >= 3; }).sort(function (a, b) { return b.conversion - a.conversion; })[0];
      if (best) insights.push(best.campaign + ' is converting best at ' + best.conversion.toFixed(1) + '% of answered calls.');
    }
    var peak = hourly.slice().sort(function (a, b) { return b.count - a.count; })[0];
    if (peak && peak.count > 0) insights.push('Peak call volume is around ' + peak.hour + ':00, with ' + peak.count + ' calls.');

    var answered = calls.filter(function (c) { return c['Call Result'] === 'Answered'; }).length;
    var abandoned = calls.filter(function (c) { return c['Call Result'] === 'Abandoned'; }).length;
    var abandonRate = calls.length ? (abandoned / calls.length) * 100 : 0;
    if (abandonRate > 8) insights.push('Abandon rate is running high at ' + abandonRate.toFixed(1) + '% — worth a look at staffing during peak hours.');

    return insights;
  }

  // ───────────────────────── PUBLIC API ─────────────────────────

  global.DashData = {
    load: load,
    getApiUrl: getApiUrl,
    setApiUrl: setApiUrl,
    setFilters: setFilters,
    getFilters: getFilters,
    getFilteredCalls: getFilteredCalls,
    getFilteredSales: getFilteredSales,
    getFilterOptions: getFilterOptions,
    getDataRange: getDataRange,
    getRaw: function () { return RAW; },
    isDemo: function () { return RAW.isDemo; },
    computeKpis: computeKpis,
    computeTrend: computeTrend,
    computeHourly: computeHourly,
    computeHourlySales: computeHourlySales,
    computeHourlyCombined: computeHourlyCombined,
    computeCallResultBreakdown: computeCallResultBreakdown,
    computeAgentTable: computeAgentTable,
    getAgentTeamMap: getAgentTeamMap,
    computeTeamTable: computeTeamTable,
    computeStateTable: computeStateTable,
    computeCampaignTable: computeCampaignTable,
    computeMixes: computeMixes,
    computeInsights: computeInsights
  };

})(window);

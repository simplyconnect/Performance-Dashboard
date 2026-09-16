/**
 * js/charts.js
 * Thin Chart.js wrappers so dashboard.js just calls DashCharts.line(...)
 * etc. with data, instead of repeating Chart.js config everywhere.
 * Keeps every chart on-brand (amber accent, black text, Inter font).
 */
(function (global) {
  'use strict';

  var COLORS = {
    amber: '#FDAC00',
    amberSoft: 'rgba(253, 172, 0, 0.18)',
    ink: '#0B0B0B',
    ink60: 'rgba(11, 11, 11, 0.6)',
    ink15: 'rgba(11, 11, 11, 0.1)',
    palette: ['#FDAC00', '#0B0B0B', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#F97316', '#06B6D4']
  };

  var instances = {};

  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = COLORS.ink60;

  function destroy(id) {
    if (instances[id]) { instances[id].destroy(); delete instances[id]; }
  }

  function baseGrid() {
    return { color: COLORS.ink15, drawTicks: false };
  }

  function line(id, labels, datasets, opts) {
    destroy(id);
    var el = document.getElementById(id);
    if (!el) return;
    instances[id] = new Chart(el, {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets.map(function (ds, i) {
          return Object.assign({
            borderColor: COLORS.palette[i % COLORS.palette.length],
            backgroundColor: COLORS.palette[i % COLORS.palette.length] + '22',
            borderWidth: 2.5,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: (opts && opts.fill) || false
          }, ds);
        })
      },
      options: Object.assign({
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: datasets.length > 1, labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: baseGrid(), beginAtZero: true }
        }
      }, opts && opts.chartOptions)
    });
  }

  function bar(id, labels, datasets, opts) {
    destroy(id);
    var el = document.getElementById(id);
    if (!el) return;
    var horizontal = opts && opts.horizontal;
    instances[id] = new Chart(el, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets.map(function (ds, i) {
          return Object.assign({
            backgroundColor: COLORS.palette[i % COLORS.palette.length],
            borderRadius: 4,
            maxBarThickness: 28
          }, ds);
        })
      },
      options: Object.assign({
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { grid: horizontal ? baseGrid() : { display: false }, beginAtZero: true },
          y: { grid: horizontal ? { display: false } : baseGrid(), beginAtZero: true }
        }
      }, opts && opts.chartOptions)
    });
  }

  function doughnut(id, labels, values, opts) {
    destroy(id);
    var el = document.getElementById(id);
    if (!el) return;
    instances[id] = new Chart(el, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map(function (_, i) { return COLORS.palette[i % COLORS.palette.length]; }),
          borderColor: '#fff',
          borderWidth: 2
        }]
      },
      options: Object.assign({
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } } }
      }, opts && opts.chartOptions)
    });
  }

  function radar(id, labels, datasets, opts) {
    destroy(id);
    var el = document.getElementById(id);
    if (!el) return;
    instances[id] = new Chart(el, {
      type: 'radar',
      data: {
        labels: labels,
        datasets: datasets.map(function (ds, i) {
          return Object.assign({
            borderColor: COLORS.palette[i % COLORS.palette.length],
            backgroundColor: COLORS.palette[i % COLORS.palette.length] + '26',
            borderWidth: 2,
            pointRadius: 2
          }, ds);
        })
      },
      options: Object.assign({
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: { r: { beginAtZero: true, max: 100, grid: baseGrid(), angleLines: { color: COLORS.ink15 } } }
      }, opts && opts.chartOptions)
    });
  }

  global.DashCharts = { line: line, bar: bar, doughnut: doughnut, radar: radar, destroy: destroy, COLORS: COLORS };

})(window);

/* ============================================================
   ATOT Dashboard — Frontend Application Logic
   Reads data from ./data/*.json files (populated by GitHub Actions)
   ============================================================ */

(() => {
  'use strict';

  // ========== STATE MANAGEMENT ==========
  const state = {
    outputData: {},           // { "2026-07-15": { ... } }
    activeTime: {},           // { "2026-07-15": { rows: [], shiftAnalysis: [], unmappedUsers: [] } }
    notes: {},                // { "2026-07-15": { rows: [] } }
    summaryRows: [],          // [ { period, ... }, ... ]
    activeSection: 'overview',
    filters: {
      overview: { from: '', to: '' },
      activeTime: { date: '', shift: '', unit: '', search: '' },
      notes: { date: '', search: '', diff: '' },
      summary: { from: '', to: '' },
    },
    sort: {
      activeTime: { key: 'productiveHours', dir: 'desc' },
      notes: { key: 'difference', dir: 'desc' },
      summary: { key: 'period', dir: 'desc' },
    },
    charts: {},
  };

  // ========== UTILITY FUNCTIONS ==========
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Normalize "2026, 07-15" → "2026-07-15"
  function normalizeDateKey(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{4})\s*,\s*(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return s;
  }

  function fmtNumber(n, digits = 0) {
    if (n === null || n === undefined || Number.isNaN(+n)) return '—';
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
  const fmtInt = (n) => fmtNumber(n, 0);
  const fmtFloat = (n, d = 2) => fmtNumber(n, d);

  function allDatesFromOutputData() {
    return Object.keys(state.outputData).sort();
  }
  function allDatesFromActiveTime() {
    return Object.keys(state.activeTime).sort();
  }
  function allDatesFromNotes() {
    return Object.keys(state.notes).sort();
  }
  function allDatesFromSummary() {
    return state.summaryRows.map(r => r.dateKey).sort();
  }

  function inRange(dateKey, from, to) {
    if (from && dateKey < from) return false;
    if (to && dateKey > to) return false;
    return true;
  }

  function latestDateKey(obj) {
    const keys = Object.keys(obj).sort();
    return keys.length ? keys[keys.length - 1] : null;
  }

  function hideLoading() {
    const el = $('#loading-overlay');
    if (el) el.classList.add('is-hidden');
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function emptyStateHTML(icon, text) {
    return `<div class="md-empty">
      <span class="material-symbols-outlined">${icon}</span>
      <p class="md-body-medium">${escapeHTML(text)}</p>
    </div>`;
  }

  // ========== DATA LOADING ==========
  async function loadJSON(path) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`Failed to load ${path}:`, err);
      return null;
    }
  }

  async function loadAllData() {
    const [outRaw, atRaw, notesRaw, sumRaw] = await Promise.all([
      loadJSON('./data/output-data.json'),
      loadJSON('./data/active-time.json'),
      loadJSON('./data/notes.json'),
      loadJSON('./data/overall-daily-summary.json'),
    ]);

    // Output Data
    if (outRaw && typeof outRaw === 'object') {
      for (const [k, v] of Object.entries(outRaw)) {
        state.outputData[normalizeDateKey(k)] = v;
      }
    }

    // Active Time
    if (atRaw && typeof atRaw === 'object') {
      for (const [k, v] of Object.entries(atRaw)) {
        state.activeTime[normalizeDateKey(k)] = v;
      }
    }

    // Notes
    if (notesRaw && typeof notesRaw === 'object') {
      for (const [k, v] of Object.entries(notesRaw)) {
        state.notes[normalizeDateKey(k)] = v;
      }
    }

    // Summary
    if (sumRaw && Array.isArray(sumRaw.rows)) {
      state.summaryRows = sumRaw.rows
        .map(r => ({ ...r, dateKey: normalizeDateKey(r.period) }))
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }

    // Set last-sync label
    const latest = latestDateKey(state.outputData);
    const syncEl = $('#last-sync');
    if (syncEl) {
      syncEl.textContent = latest ? `Latest data: ${latest}` : 'No data yet';
    }
  }

  // ========== NAVIGATION ==========
  function initNavigation() {
    $$('.md-tab').forEach(tab => {
      tab.addEventListener('click', () => switchSection(tab.dataset.section));
    });
  }

  function switchSection(name) {
    state.activeSection = name;
    $$('.md-tab').forEach(t => {
      const active = t.dataset.section === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
    $$('.md-section').forEach(s => {
      const active = s.dataset.section === name;
      s.classList.toggle('is-active', active);
      s.hidden = !active;
    });
    renderCurrentSection();
  }

  // ========== OVERVIEW SECTION ==========
  function renderOverview(selectedDate = null) {
    const grid = $('#kpi-grid');
    const dateLabel = $('#overview-date-label');
    const noDataEl = $('#overview-no-data');
    grid.innerHTML = '';

    // Determine which date to show
    const dateToShow = selectedDate || latestDateKey(state.outputData);
    
    if (!dateToShow) {
      dateLabel.textContent = 'No data available';
      grid.innerHTML = emptyStateHTML('inbox_empty', 'No snapshot data yet. Run the sync pipeline to populate the dashboard.');
      if (noDataEl) noDataEl.hidden = true;
      renderOverviewChart();
      return;
    }

    const d = state.outputData[dateToShow];
    
    if (!d) {
      // No data for this date
      if (noDataEl) noDataEl.hidden = false;
      grid.innerHTML = '';
      dateLabel.textContent = `Selected: ${dateToShow}`;
      renderOverviewChart();
      return;
    }

    // Data exists
    if (noDataEl) noDataEl.hidden = true;
    dateLabel.textContent = `Snapshot for ${d.period || dateToShow}`;

    const kpis = [
      { label: 'Total Hours', value: fmtFloat(d.totalHours), context: 'Production + Training', primary: true, hours: null },
      { label: 'Total Users', value: fmtInt(d.totalUsers), context: 'All users', hours: null },
      { label: 'Production Users', value: fmtInt(d.productionUsers), context: 'Active today', hours: `${fmtFloat(d.productionHours)} hrs` },
      { label: 'Training Users', value: fmtInt(d.trainingUsers), context: 'Active today', hours: `${fmtFloat(d.trainingHours)} hrs` },
      { label: 'Avg Hrs / Prod. User', value: fmtFloat(d.avgHoursPerProductionUser), context: 'Production only', hours: null },
      { label: 'Avg Hrs / User', value: fmtFloat(d.avgHoursPerUser), context: 'All users', hours: null },
    ];

    grid.innerHTML = kpis.map(k => {
      const hoursBadge = k.hours ? `<div class="md-kpi__hours-badge" title="Hours">${k.hours}</div>` : '';
      const hoursClass = k.hours ? 'md-kpi--with-hours' : '';
      return `
        <div class="md-kpi ${k.primary ? 'md-kpi--primary' : ''} ${hoursClass}">
          <span class="md-kpi__label">${k.label}</span>
          <span class="md-kpi__value">${k.value}</span>
          <span class="md-kpi__context">${k.context}</span>
          ${hoursBadge}
        </div>
      `;
    }).join('');

    renderOverviewChart();
  }

  function renderOverviewChart() {
    const ctx = $('#overview-trend-chart');
    if (!ctx) return;
    if (state.charts.overviewTrend) state.charts.overviewTrend.destroy();

    const from = state.filters.overview.from;
    const to = state.filters.overview.to;
    const rows = state.summaryRows.filter(r => inRange(r.dateKey, from, to));

    if (!rows.length) {
      state.charts.overviewTrend = null;
      ctx.parentElement.innerHTML = emptyStateHTML('timeline_empty', 'No historical data in the selected range.');
      return;
    }

    state.charts.overviewTrend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: rows.map(r => r.dateKey),
        datasets: [
          {
            label: 'Total Hours',
            data: rows.map(r => r.totalHours),
            borderColor: getCSS('--md-primary'),
            backgroundColor: hexToRGBA(getCSS('--md-primary'), 0.15),
            fill: true,
            tension: 0.3,
            yAxisID: 'y',
          },
          {
            label: 'Total Users',
            data: rows.map(r => r.totalUsers),
            borderColor: getCSS('--md-tertiary'),
            backgroundColor: hexToRGBA(getCSS('--md-tertiary'), 0.1),
            fill: false,
            tension: 0.3,
            yAxisID: 'y1',
          },
        ],
      },
      options: chartOptions({
        y: { title: 'Hours', position: 'left', color: getCSS('--md-primary') },
        y1: { title: 'Users', position: 'right', color: getCSS('--md-tertiary'), grid: { drawOnChartArea: false } },
      }),
    });
  }

  // ========== ACTIVE TIME SECTION ==========
  function populateActiveTimeFilters() {
    const dateSel = $('#at-date');
    const dates = allDatesFromActiveTime();

    dateSel.innerHTML = dates.length
      ? dates.map(d => `<option value="${d}">${d}</option>`).join('')
      : '<option value="">No data</option>';

    if (dates.length && !state.filters.activeTime.date) {
      state.filters.activeTime.date = dates[dates.length - 1];
    }
    dateSel.value = state.filters.activeTime.date;

    refreshShiftAndUnitOptions();
  }

  function refreshShiftAndUnitOptions() {
    const dateKey = state.filters.activeTime.date;
    const data = state.activeTime[dateKey];
    const shiftSel = $('#at-shift');
    const unitSel = $('#at-unit');

    const shifts = new Set();
    const units = new Set();
    if (data && Array.isArray(data.rows)) {
      data.rows.forEach(r => {
        if (r.shift) shifts.add(r.shift);
        if (r.unit) units.add(r.unit);
      });
    }
    shiftSel.innerHTML = '<option value="">All shifts</option>' +
      [...shifts].sort().map(s => `<option value="${s}">${s}</option>`).join('');
    unitSel.innerHTML = '<option value="">All units</option>' +
      [...units].sort().map(u => `<option value="${u}">${u}</option>`).join('');

    shiftSel.value = state.filters.activeTime.shift;
    unitSel.value = state.filters.activeTime.unit;
  }

  function renderActiveTime() {
    const dateKey = state.filters.activeTime.date;
    const data = state.activeTime[dateKey];

    // Unmapped users callout - High Visibility Fix
    const unmappedEl = $('#at-unmapped');
    const unmappedText = $('#at-unmapped-text');
    if (data && Array.isArray(data.unmappedUsers) && data.unmappedUsers.length) {
      unmappedEl.hidden = false;
      unmappedText.innerHTML = `
        <span class="md-title-small">⚠️ Unmapped Users</span>
        <p class="md-body-small">The following users have no valid shift mapping:</p>
        <span class="unmapped-emails">${data.unmappedUsers.join(', ')}</span>
      `;
    } else {
      unmappedEl.hidden = true;
    }

    // Shift analysis cards - Old Design Restored
    const shiftGrid = $('#at-shift-grid');
    if (data && Array.isArray(data.shiftAnalysis) && data.shiftAnalysis.length) {
      // Calculate actual hours from rows data for each shift (fallback for incorrect backend data)
      const hoursByShift = {};
      if (data.rows && Array.isArray(data.rows)) {
        data.rows.forEach(r => {
          const shift = r.shift || 'Unknown';
          if (!hoursByShift[shift]) {
            hoursByShift[shift] = { productionHours: 0, trainingHours: 0 };
          }
          if (r.productiveHours && !isNaN(r.productiveHours)) {
            hoursByShift[shift].productionHours += parseFloat(r.productiveHours);
          }
          if (r.trainingHours && !isNaN(r.trainingHours)) {
            hoursByShift[shift].trainingHours += parseFloat(r.trainingHours);
          }
        });
      }

      shiftGrid.innerHTML = data.shiftAnalysis.map(s => {
        const shiftKey = s.shift || 'Unknown';
        let prodHours = s.productionHours;
        let trainHours = s.trainingHours;

        if (hoursByShift[shiftKey]) {
          const calcProd = hoursByShift[shiftKey].productionHours;
          const calcTrain = hoursByShift[shiftKey].trainingHours;
          if (calcProd > prodHours * 10) prodHours = calcProd;
          if (calcTrain > trainHours * 10) trainHours = calcTrain;
        }

        return `
        <div class="md-shift-card">
          <div class="md-shift-card__header">
            <h3 class="md-shift-card__title">Shift ${s.shift === 'Unknown' ? 'Unknown' : s.shift}</h3>
            <span class="md-shift-badge">${s.shift === 'Unknown' ? 'UNK' : s.shift}</span>
          </div>
          <div class="md-shift-card__row md-shift-card__row--highlight">
            <span>Production users</span>
            <span>${fmtInt(s.productionUsers)}</span>
          </div>
          <div class="md-shift-card__row md-shift-card__row--highlight">
            <span>Production hours</span>
            <span>${fmtFloat(prodHours)}</span>
          </div>
          <div class="md-shift-card__row">
            <span>Training users</span>
            <span>${fmtInt(s.trainingUsers)}</span>
          </div>
          <div class="md-shift-card__row">
            <span>Training hours</span>
            <span>${fmtFloat(trainHours)}</span>
          </div>
          <div class="md-shift-card__row">
            <span>Avg hrs / prod. user</span>
            <span>${fmtFloat(s.avgPerProductionUser)}</span>
          </div>
          <div class="md-shift-card__row">
            <span>Avg hrs / user</span>
            <span>${fmtFloat(s.avgPerUser)}</span>
          </div>
        </div>
      `}).join('');
    } else {
      shiftGrid.innerHTML = emptyStateHTML('event_busy', 'No shift analysis for this date.');
    }

    // Labeler table
    const tbody = $('#at-table tbody');
    const countEl = $('#at-count');
    let rows = (data && Array.isArray(data.rows)) ? data.rows.slice() : [];

    const f = state.filters.activeTime;
    if (f.shift) rows = rows.filter(r => r.shift === f.shift);
    if (f.unit) rows = rows.filter(r => r.unit === f.unit);
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(r => (r.labeler || '').toLowerCase().includes(q));
    }

    const sortState = state.sort.activeTime;
    rows.sort((a, b) => {
      const av = a[sortState.key], bv = b[sortState.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortState.dir === 'asc' ? av - bv : bv - av;
      }
      return sortState.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });

    countEl.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHTML('search_off', 'No labeler rows match the current filters.')}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escapeHTML(r.labeler || '')}</td>
        <td>${escapeHTML(r.tlQtc || '')}</td>
        <td><span class="md-shift-badge">${escapeHTML(r.shift || '—')}</span></td>
        <td>${escapeHTML(r.pc || '')}</td>
        <td>${escapeHTML(r.unit || '')}</td>
        <td class="num">${fmtFloat(r.productiveHours)}</td>
      </tr>
    `).join('');
  }

  // ========== NOTES SECTION ==========
  function populateNotesFilters() {
    const dateSel = $('#notes-date');
    const dates = allDatesFromNotes();
    dateSel.innerHTML = dates.length
      ? dates.map(d => `<option value="${d}">${d}</option>`).join('')
      : '<option value="">No data</option>';
    if (dates.length && !state.filters.notes.date) {
      state.filters.notes.date = dates[dates.length - 1];
    }
    dateSel.value = state.filters.notes.date;
  }

  function categorizeDifference(diff) {
    if (diff === null || diff === undefined || Number.isNaN(+diff)) return 'unknown';
    const n = +diff;
    if (Math.abs(n) < 0.0001) return 'balanced';
    return n > 0 ? 'prod-heavy' : 'train-heavy';
  }

  function renderNotes() {
    const dateKey = state.filters.notes.date;
    const data = state.notes[dateKey];
    const tbody = $('#notes-table tbody');
    const countEl = $('#notes-count');

    let rows = (data && Array.isArray(data.rows)) ? data.rows.slice() : [];
    rows = rows.map(r => ({ ...r, category: categorizeDifference(r.difference) }));

    const f = state.filters.notes;
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(r => (r.user || '').toLowerCase().includes(q));
    }
    if (f.diff) rows = rows.filter(r => r.category === f.diff);

    const sortState = state.sort.notes;
    rows.sort((a, b) => {
      const av = a[sortState.key], bv = b[sortState.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortState.dir === 'asc' ? av - bv : bv - av;
      }
      return sortState.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });

    countEl.textContent = `${rows.length} note${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHTML('note_add', 'No notes for this selection.')}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const chipClass = `diff-chip diff-chip--${r.category}`;
      const chipLabel = r.category === 'balanced' ? 'Balanced'
        : r.category === 'prod-heavy' ? 'Prod. heavy'
        : r.category === 'train-heavy' ? 'Train. heavy' : '—';
      return `
        <tr>
          <td>${escapeHTML(r.user || '')}</td>
          <td class="num">${fmtFloat(r.trainingHours, 4)}</td>
          <td class="num">${fmtFloat(r.productionHours, 4)}</td>
          <td class="num">${fmtFloat(r.difference, 4)}</td>
          <td><span class="${chipClass}">${chipLabel}</span></td>
          <td>${escapeHTML(r.note || '')}</td>
        </tr>
      `;
    }).join('');
  }

  // ========== OVERALL DAILY SUMMARY SECTION ==========
  function renderSummary() {
    const from = state.filters.summary.from;
    const to = state.filters.summary.to;
    const rows = state.summaryRows.filter(r => inRange(r.dateKey, from, to));

    renderSummaryCharts(rows);

    const tbody = $('#sum-table tbody');
    const countEl = $('#sum-count');

    const sorted = rows.slice();
    const sortState = state.sort.summary;
    sorted.sort((a, b) => {
      const av = a[sortState.key], bv = b[sortState.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortState.dir === 'asc' ? av - bv : bv - av;
      }
      return sortState.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });

    countEl.textContent = `${sorted.length} day${sorted.length === 1 ? '' : 's'}`;

    if (!sorted.length) {
      tbody.innerHTML = `<tr><td colspan="9">${emptyStateHTML('event_available', 'No daily summary records in the selected range.')}</td></tr>`;
      return;
    }

    tbody.innerHTML = sorted.map(r => `
      <tr>
        <td>${escapeHTML(r.dateKey)}</td>
        <td class="num">${fmtInt(r.totalUsers)}</td>
        <td class="num">${fmtInt(r.productionUsers)}</td>
        <td class="num">${fmtInt(r.trainingUsers)}</td>
        <td class="num">${fmtFloat(r.totalHours)}</td>
        <td class="num">${fmtFloat(r.productionHours)}</td>
        <td class="num">${fmtFloat(r.trainingHours)}</td>
        <td class="num">${fmtFloat(r.avgHoursPerProductionUser)}</td>
        <td class="num">${fmtFloat(r.avgHoursPerUser)}</td>
      </tr>
    `).join('');
  }

  function renderSummaryCharts(rows) {
    // Totals chart
    const ctxTotals = $('#sum-totals-chart');
    if (ctxTotals) {
      if (state.charts.sumTotals) state.charts.sumTotals.destroy();
      if (!rows.length) {
        ctxTotals.parentElement.innerHTML = emptyStateHTML('timeline_empty', 'No data in range.');
      } else {
        state.charts.sumTotals = new Chart(ctxTotals, {
          type: 'line',
          data: {
            labels: rows.map(r => r.dateKey),
            datasets: [
              {
                label: 'Total Hours',
                data: rows.map(r => r.totalHours),
                borderColor: getCSS('--md-primary'),
                backgroundColor: hexToRGBA(getCSS('--md-primary'), 0.15),
                fill: true,
                tension: 0.3,
                yAxisID: 'y',
              },
              {
                label: 'Production Hours',
                data: rows.map(r => r.productionHours),
                borderColor: getCSS('--md-secondary'),
                backgroundColor: 'transparent',
                tension: 0.3,
                yAxisID: 'y',
              },
              {
                label: 'Training Hours',
                data: rows.map(r => r.trainingHours),
                borderColor: getCSS('--md-tertiary'),
                backgroundColor: 'transparent',
                tension: 0.3,
                yAxisID: 'y',
              },
            ],
          },
          options: chartOptions({ y: { title: 'Hours', position: 'left' } }),
        });
      }
    }

    // Avg chart
    const ctxAvg = $('#sum-avg-chart');
    if (ctxAvg) {
      if (state.charts.sumAvg) state.charts.sumAvg.destroy();
      if (!rows.length) {
        ctxAvg.parentElement.innerHTML = emptyStateHTML('timeline_empty', 'No data in range.');
      } else {
        state.charts.sumAvg = new Chart(ctxAvg, {
          type: 'bar',
          data: {
            labels: rows.map(r => r.dateKey),
            datasets: [
              {
                label: 'Avg hrs / prod. user',
                data: rows.map(r => r.avgHoursPerProductionUser),
                backgroundColor: hexToRGBA(getCSS('--md-primary'), 0.7),
                borderRadius: 6,
              },
              {
                label: 'Avg hrs / user',
                data: rows.map(r => r.avgHoursPerUser),
                backgroundColor: hexToRGBA(getCSS('--md-tertiary'), 0.7),
                borderRadius: 6,
              },
            ],
          },
          options: chartOptions({ y: { title: 'Hours', position: 'left', beginAtZero: true } }),
        });
      }
    }
  }

  // ========== CHART HELPERS ==========
  function chartOptions(axes) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { family: getCSS('--md-font') || 'Roboto', size: 12 },
            color: getCSS('--md-on-surface-variant'),
            usePointStyle: true,
            padding: 16,
          },
        },
        tooltip: {
          backgroundColor: getCSS('--md-surface-container-highest'),
          titleColor: getCSS('--md-on-surface'),
          bodyColor: getCSS('--md-on-surface'),
          borderColor: getCSS('--md-outline-variant'),
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                const val = context.parsed.y;
                const digits = Math.abs(val) >= 100 ? 0 : (Math.abs(val) >= 10 ? 1 : 2);
                label += new Intl.NumberFormat('en-US', {
                  minimumFractionDigits: digits,
                  maximumFractionDigits: digits
                }).format(val);
              }
              return label;
            }
          }
        },
      },
      scales: Object.fromEntries(
        Object.entries(axes).map(([key, cfg]) => [key, {
          beginAtZero: cfg.beginAtZero ?? false,
          position: cfg.position || 'left',
          title: cfg.title ? { display: true, text: cfg.title, color: cfg.color || getCSS('--md-on-surface-variant') } : undefined,
          ticks: { 
            color: cfg.color || getCSS('--md-on-surface-variant'),
            callback: function(value) {
              return new Intl.NumberFormat('en-US', {
                notation: 'standard',
                maximumFractionDigits: 0
              }).format(value);
            }
          },
          grid: cfg.grid || { color: hexToRGBA(getCSS('--md-outline-variant'), 0.4) },
        }])
      ),
    };
  }

  function getCSS(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  function hexToRGBA(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ========== RENDER DISPATCHER ==========
  function renderCurrentSection() {
    switch (state.activeSection) {
      case 'overview': renderOverview(); break;
      case 'active-time': renderActiveTime(); break;
      case 'notes': renderNotes(); break;
      case 'summary': renderSummary(); break;
    }
  }

  // ========== FILTER WIRING ==========
  function wireFilters() {
    // Overview date selector (NEW)
    const overviewDateInput = $('#overview-date');
    const availableDates = allDatesFromOutputData();
    
    if (overviewDateInput && availableDates.length > 0) {
      overviewDateInput.min = availableDates[0];
      overviewDateInput.max = availableDates[availableDates.length - 1];
      overviewDateInput.value = availableDates[availableDates.length - 1]; // Default to latest
      
      overviewDateInput.addEventListener('change', e => {
        renderOverview(e.target.value);
      });
    } else if (overviewDateInput) {
      overviewDateInput.disabled = true;
      overviewDateInput.placeholder = 'No data available';
    }

    // Overview date range
    const overviewFrom = $('#overview-from');
    const overviewTo = $('#overview-to');
    const summaryDates = allDatesFromSummary();
    if (summaryDates.length) {
      overviewFrom.min = overviewTo.min = summaryDates[0];
      overviewFrom.max = overviewTo.max = summaryDates[summaryDates.length - 1];
      $('#sum-from').min = $('#sum-to').min = summaryDates[0];
      $('#sum-to').max = $('#sum-from').max = summaryDates[summaryDates.length - 1];
    }
    overviewFrom.addEventListener('change', e => {
      state.filters.overview.from = e.target.value;
      $('#sum-from').value = e.target.value;
      state.filters.summary.from = e.target.value;
      renderOverview();
      renderSummary();
    });
    overviewTo.addEventListener('change', e => {
      state.filters.overview.to = e.target.value;
      $('#sum-to').value = e.target.value;
      state.filters.summary.to = e.target.value;
      renderOverview();
      renderSummary();
    });

    $('#sum-from').addEventListener('change', e => {
      state.filters.summary.from = e.target.value;
      overviewFrom.value = e.target.value;
      state.filters.overview.from = e.target.value;
      renderSummary();
      renderOverview();
    });
    $('#sum-to').addEventListener('change', e => {
      state.filters.summary.to = e.target.value;
      overviewTo.value = e.target.value;
      state.filters.overview.to = e.target.value;
      renderSummary();
      renderOverview();
    });

    // Active Time filters
    $('#at-date').addEventListener('change', e => {
      state.filters.activeTime.date = e.target.value;
      state.filters.activeTime.shift = '';
      state.filters.activeTime.unit = '';
      refreshShiftAndUnitOptions();
      renderActiveTime();
    });
    $('#at-shift').addEventListener('change', e => {
      state.filters.activeTime.shift = e.target.value;
      renderActiveTime();
    });
    $('#at-unit').addEventListener('change', e => {
      state.filters.activeTime.unit = e.target.value;
      renderActiveTime();
    });
    $('#at-search').addEventListener('input', e => {
      state.filters.activeTime.search = e.target.value;
      renderActiveTime();
    });

    // Notes filters
    $('#notes-date').addEventListener('change', e => {
      state.filters.notes.date = e.target.value;
      renderNotes();
    });
    $('#notes-search').addEventListener('input', e => {
      state.filters.notes.search = e.target.value;
      renderNotes();
    });
    $$('#notes-diff-chips .md-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#notes-diff-chips .md-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        state.filters.notes.diff = chip.dataset.diff;
        renderNotes();
      });
    });

    // Sortable table headers
    wireSortable('#at-table', 'activeTime', renderActiveTime);
    wireSortable('#notes-table', 'notes', renderNotes);
    wireSortable('#sum-table', 'summary', renderSummary);
  }

  function wireSortable(tableSel, stateKey, renderFn) {
    $$(tableSel + ' thead th').forEach(th => {
      const key = th.dataset.sort;
      if (!key) return;
      th.addEventListener('click', () => {
        const cur = state.sort[stateKey];
        if (cur.key === key) {
          cur.dir = cur.dir === 'asc' ? 'desc' : 'asc';
        } else {
          cur.key = key;
          cur.dir = 'asc';
        }
        renderFn();
      });
    });
  }

  // ========== INITIALIZATION ==========
  async function init() {
    initNavigation();
    await loadAllData();
    populateActiveTimeFilters();
    populateNotesFilters();
    wireFilters();
    renderOverview(); // Renders with latest date by default
    hideLoading();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

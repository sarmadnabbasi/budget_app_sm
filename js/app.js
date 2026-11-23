/* Budget — UI layer
 * Renders four views (home / history / plans / settings) from BudgetStore and
 * drives the add-expense, category and plan-detail sheets.
 */
(function () {
  'use strict';

  var S = window.BudgetStore;

  var ui = {
    view: 'home',
    month: S.currentMonth(),
    historyRange: 6,
    form: { categoryId: null, method: 'cash', editingId: null },
    sheetOpen: null
  };

  var CURRENCIES = [
    ['USD', '$', 'US dollar'], ['EUR', '€', 'Euro'], ['GBP', '£', 'British pound'],
    ['INR', '₹', 'Indian rupee'], ['PKR', '₨', 'Pakistani rupee'], ['BDT', '৳', 'Bangladeshi taka'],
    ['LKR', 'Rs', 'Sri Lankan rupee'], ['NPR', 'Rs', 'Nepalese rupee'], ['AED', 'AED', 'UAE dirham'],
    ['SAR', 'SAR', 'Saudi riyal'], ['QAR', 'QAR', 'Qatari riyal'], ['KWD', 'KWD', 'Kuwaiti dinar'],
    ['TRY', '₺', 'Turkish lira'], ['EGP', 'E£', 'Egyptian pound'], ['NGN', '₦', 'Nigerian naira'],
    ['KES', 'KSh', 'Kenyan shilling'], ['GHS', 'GH¢', 'Ghanaian cedi'], ['ZAR', 'R', 'South African rand'],
    ['IDR', 'Rp', 'Indonesian rupiah'], ['MYR', 'RM', 'Malaysian ringgit'], ['PHP', '₱', 'Philippine peso'],
    ['SGD', 'S$', 'Singapore dollar'], ['JPY', '¥', 'Japanese yen'], ['CNY', '¥', 'Chinese yuan'],
    ['KRW', '₩', 'South Korean won'], ['BRL', 'R$', 'Brazilian real'], ['MXN', 'MX$', 'Mexican peso'],
    ['CAD', 'C$', 'Canadian dollar'], ['AUD', 'A$', 'Australian dollar'], ['CHF', 'CHF', 'Swiss franc'],
    ['SEK', 'kr', 'Swedish krona'], ['PLN', 'zł', 'Polish złoty'], ['RUB', '₽', 'Russian ruble']
  ];

  var PALETTE = S.PALETTE;

  /* ── small helpers ─────────────────────────────────────────── */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n, opts) {
    var s = S.settings();
    var options = Object.assign({ minimumFractionDigits: 2, maximumFractionDigits: 2 }, opts || {});
    try {
      return new Intl.NumberFormat(s.locale || undefined,
        Object.assign({ style: 'currency', currency: s.currency || 'USD' }, options)).format(Number(n) || 0);
    } catch (e) {
      return (s.symbol || '$') + (Number(n) || 0).toFixed(options.maximumFractionDigits || 2);
    }
  }

  function symbol() {
    var s = S.settings();
    if (s.symbol) return s.symbol;
    for (var i = 0; i < CURRENCIES.length; i++) if (CURRENCIES[i][0] === s.currency) return CURRENCIES[i][1];
    return '$';
  }

  function fmtShort(n) {
    var abs = Math.abs(n);
    var sym = symbol();
    if (abs >= 1000000) return sym + (n / 1000000).toFixed(1) + 'M';
    if (abs >= 10000) return sym + Math.round(n / 1000) + 'k';
    return fmt(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ── theme ─────────────────────────────────────────────────── */

  function applyTheme(theme) {
    var t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    var meta = $('#themeColorMeta');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f4f6fb' : '#0a0e1a');
    var btn = $('#themeBtn');
    if (btn) {
      btn.innerHTML = t === 'light'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a7 7 0 1 0 10.8 10.8Z"/></svg>';
      btn.setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
    }
  }

  /* ── view switching ────────────────────────────────────────── */

  var VIEWS = ['home', 'history', 'plans', 'settings'];

  function setView(name, fromHash) {
    if (VIEWS.indexOf(name) < 0) name = 'home';
    ui.view = name;
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
    $$('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', t.getAttribute('data-view') === name ? 'true' : 'false');
    });
    if (name === 'home') renderHome();
    if (name === 'history') renderHistory();
    if (name === 'plans') renderPlans();
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
    // Keep the URL in step so a view can be bookmarked or reloaded directly.
    if (!fromHash) {
      var hash = '#' + name;
      if (location.hash !== hash) {
        try { history.replaceState(null, '', hash); } catch (e) { location.hash = name; }
      }
    }
  }

  /* ── month navigation ──────────────────────────────────────── */

  function renderMonthLabel() {
    $('#monthLabel').textContent = S.monthName(ui.month);
    $('#monthJump').hidden = ui.month === S.currentMonth();
  }

  function stepMonth(dir) {
    ui.month = S.addMonths(ui.month, dir);
    renderMonthLabel();
    renderHome();
  }

  /* ── HOME ──────────────────────────────────────────────────── */

  function renderHome() {
    var ym = ui.month;
    var sum = S.monthSummary(ym);
    var prev = S.monthSummary(S.addMonths(ym, -1));
    var settings = S.settings();
    var budget = Number(settings.totalBudget) > 0 ? Number(settings.totalBudget) : null;
    var hasAny = S.get().expenses.length > 0;

    var deltaPct = null;
    if (prev.total > 0) deltaPct = ((sum.total - prev.total) / prev.total) * 100;

    var html = '';

    /* hero */
    html += '<div class="hero">' +
      '<div class="hero__label">Spent in ' + esc(S.monthName(ym)) + '</div>' +
      '<div class="hero__amount">' + esc(fmt(sum.total)) + '</div>';

    var meta = sum.count === 0
      ? 'Nothing recorded yet'
      : sum.count + (sum.count === 1 ? ' entry' : ' entries') + ' · ' + (budget ? '' : 'vs ' + esc(fmt(prev.total)) + ' last month');
    html += '<div class="hero__meta">' + meta + '</div>';

    if (deltaPct !== null && sum.count > 0) {
      var cls = Math.abs(deltaPct) < 0.5 ? 'flat' : (deltaPct > 0 ? 'up' : 'down');
      var arrow = cls === 'up' ? '▲' : (cls === 'down' ? '▼' : '•');
      html += '<div class="delta delta--' + cls + '">' + arrow + ' ' +
        Math.abs(deltaPct).toFixed(0) + '% ' + (deltaPct > 0 ? 'more' : deltaPct < 0 ? 'less' : 'same') +
        ' than ' + esc(S.shortMonthName(S.addMonths(ym, -1))) + '</div>';
    }

    html += '<div class="hero__split">' +
      '<div><div class="mini-stat__label">One-off</div><div class="mini-stat__value">' +
        esc(fmt(sum.total - sum.installmentPart)) + '</div></div>' +
      '<div><div class="mini-stat__label">Installments</div><div class="mini-stat__value">' +
        esc(fmt(sum.installmentPart)) + '</div></div>' +
    '</div></div>';

    /* overall budget */
    if (budget) {
      var pct = Math.min(100, (sum.total / budget) * 100);
      var over = sum.total > budget;
      var left = budget - sum.total;
      var barColor = over ? 'var(--bad)' : pct > 85 ? 'var(--warn)' : 'var(--good)';
      html += '<div class="card">' +
        '<div class="card__title"><span>Monthly budget</span><span>' + Math.round((sum.total / budget) * 100) + '% used</span></div>' +
        '<div class="budget-row"><strong>' + esc(fmt(sum.total)) + '</strong><span>of ' + esc(fmt(budget)) + '</span></div>' +
        '<div class="budget-bar"><div class="budget-bar__fill" style="width:' + pct.toFixed(1) + '%;background:' + barColor + '"></div></div>' +
        '<div class="budget-row" style="margin:8px 0 0">' +
          '<em style="font-style:normal;color:' + (over ? 'var(--bad)' : 'var(--text-dim)') + '">' +
          (over ? esc(fmt(-left)) + ' over budget' : esc(fmt(left)) + ' left to spend') + '</em></div>' +
      '</div>';
    }

    /* categories */
    if (sum.categories.length) {
      var rows = sum.categories.map(function (c) {
        var cat = c.category;
        var limit = Number(cat.budget) > 0 ? Number(cat.budget) : null;
        var share = limit ? Math.min(100, (c.total / limit) * 100) : Math.max(4, c.share * 100);
        var fill = limit && c.total > limit ? 'var(--bad)' : cat.color;
        return '<div class="cat-row">' +
          '<div class="cat-ico" style="background:' + hexA(cat.color, .16) + '">' + esc(cat.emoji) + '</div>' +
          '<div class="cat-main">' +
            '<div class="cat-main__top">' +
              '<span class="cat-main__name">' + esc(cat.name) + '</span>' +
              '<span class="cat-main__value">' + esc(fmt(c.total)) + '</span>' +
            '</div>' +
            '<div class="cat-main__sub">' + Math.round(c.share * 100) + '% of month' +
              (limit ? ' · limit ' + esc(fmt(limit, { minimumFractionDigits: 0, maximumFractionDigits: 0 })) : '') +
              (c.count > 1 ? ' · ' + c.count + ' entries' : '') + '</div>' +
            '<div class="cat-track"><div class="cat-track__fill" style="width:' + share.toFixed(1) + '%;background:' + fill + '"></div></div>' +
          '</div>' +
        '</div>';
      }).join('');
      html += '<div class="card"><div class="card__title"><span>Where it went</span>' +
        '<span><button type="button" class="monthbar__jump" data-action="goto-history">see trends</button></span></div>' +
        rows + '</div>';
    }

    /* expense list */
    if (sum.rows.length) {
      var groups = {};
      var order = [];
      sum.rows.forEach(function (r) {
        var key = r.expense.date;
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(r);
      });
      var listHtml = order.map(function (key) {
        var items = groups[key];
        var dayTotal = items.reduce(function (s, r) { return s + r.charge; }, 0);
        var inner = items.map(function (r) {
          var e = r.expense;
          var cat = S.categoryById(e.categoryId);
          var status = e.months >= 2 ? S.planStatus(e, ym) : null;
          return '<button type="button" class="exp" data-action="edit-expense" data-id="' + esc(e.id) + '">' +
            '<span class="cat-ico" style="background:' + hexA(cat.color, .16) + ';font-size:16px">' + esc(cat.emoji) + '</span>' +
            '<span class="exp__main">' +
              '<span class="exp__title">' + esc(e.note || cat.name) + '</span>' +
              '<span class="exp__sub">' + esc(cat.name) +
                (e.method === 'credit' ? ' · card' : e.method === 'debit' ? ' · debit' : '') + '</span>' +
            '</span>' +
            '<span class="exp__right">' +
              '<span class="exp__amount">' + esc(fmt(r.charge)) + '</span>' +
              (status ? '<br><span class="exp__tag exp__tag--plan">' + Math.min(status.paidCount, e.months) + '/' + e.months + ' plan</span>' : '') +
            '</span>' +
          '</button>';
        }).join('');
        return '<div class="day-group"><div class="day-group__head">' +
          '<span>' + esc(friendlyDate(key)) + '</span><span>' + esc(fmt(dayTotal)) + '</span>' +
          '</div>' + inner + '</div>';
      }).join('');
      html += '<div class="card card--flush"><div class="card__title" style="padding:14px 15px 10px;margin:0;border-bottom:1px solid var(--line-soft)">' +
        '<span>Entries</span><span>' + sum.count + '</span></div>' + listHtml + '</div>';
    } else if (!hasAny) {
      html += emptyState('🧾', 'No expenses yet',
        'Tap the + button to add your first expense. Choose a category, and split it into installments if you paid by card.');
    } else {
      html += emptyState('📅', 'Nothing in ' + S.monthName(ym),
        'No expenses or installment charges fall in this month. Use the arrows above to look at another month.');
    }

    $('#homeContent').innerHTML = html;
  }

  function friendlyDate(dateStr) {
    var today = S.todayStr();
    var yest = S.toDateStr(new Date(Date.now() - 86400000));
    if (dateStr === today) return 'Today · ' + S.formatDate(dateStr);
    if (dateStr === yest) return 'Yesterday · ' + S.formatDate(dateStr);
    return S.formatDate(dateStr);
  }

  function hexA(hex, alpha) {
    var h = String(hex || '#8a94a8').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r)) return 'rgba(138,148,168,' + alpha + ')';
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function emptyState(ico, title, text) {
    return '<div class="card"><div class="empty">' +
      '<span class="empty__ico" aria-hidden="true">' + ico + '</span>' +
      '<div class="empty__title">' + esc(title) + '</div><p>' + esc(text) + '</p></div></div>';
  }

  /* ── HISTORY ───────────────────────────────────────────────── */

  var charts = {};

  function destroyChart(id) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  }

  function renderHistory() {
    var months = ui.historyRange;
    var series = S.monthlySeries(months, S.currentMonth());
    var end = series[series.length - 1].month;
    var start = series[0].month;
    var cat = S.categoryBreakdown(start, end);
    var items = S.noteBreakdown(start, end, 6);
    var total = series.reduce(function (s, m) { return s + m.total; }, 0);
    var active = series.filter(function (m) { return m.total > 0; });
    var avg = active.length ? total / active.length : 0;
    var peak = series.reduce(function (best, m) { return m.total > best.total ? m : best; }, series[0]);

    var html = '';

    html += '<div class="segmented segmented--wide" id="rangeSwitch" role="group" aria-label="Period">' +
      [3, 6, 12].map(function (n) {
        return '<button type="button" data-action="range" data-range="' + n + '" class="' +
          (n === months ? 'is-active' : '') + '">' + n + ' months</button>';
      }).join('') + '</div>';

    html += '<div class="hero">' +
      '<div class="hero__label">Total · last ' + months + ' months</div>' +
      '<div class="hero__amount">' + esc(fmt(total)) + '</div>' +
      '<div class="hero__split">' +
        '<div><div class="mini-stat__label">Average / month</div><div class="mini-stat__value">' + esc(fmt(avg)) + '</div></div>' +
        '<div><div class="mini-stat__label">Highest month</div><div class="mini-stat__value">' + esc(fmt(peak.total)) +
          '<small style="font-weight:500;color:var(--text-dim);font-size:12px"> ' + esc(S.shortMonthName(peak.month)) + '</small></div></div>' +
      '</div></div>';

    html += '<div class="card"><div class="card__title"><span>Month by month</span><span>' + esc(S.shortMonthName(start)) + ' – ' + esc(S.shortMonthName(end)) + '</span></div>' +
      '<div class="chart-wrap"><canvas id="trendChart" aria-label="Monthly spending chart" role="img"></canvas></div></div>';

    if (cat.rows.length) {
      html += '<div class="card"><div class="card__title"><span>By category</span><span>' + esc(fmt(cat.total)) + '</span></div>' +
        '<div class="chart-wrap chart-wrap--pie"><canvas id="catChart" aria-label="Category breakdown chart" role="img"></canvas></div>' +
        '<div class="chart-legend">' + cat.rows.map(function (r) {
          return '<div class="chart-legend__row">' +
            '<span class="chart-legend__dot" style="background:' + r.category.color + '"></span>' +
            '<span class="chart-legend__name">' + esc(r.category.emoji + ' ' + r.category.name) + '</span>' +
            '<span class="chart-legend__val">' + esc(fmt(r.total)) + ' · ' + Math.round(r.share * 100) + '%</span>' +
          '</div>';
        }).join('') + '</div></div>';
    }

    if (items.length) {
      var maxItem = items[0].total || 1;
      html += '<div class="card"><div class="card__title"><span>Top items</span><span>by note</span></div>' +
        items.map(function (it) {
          var cat2 = S.categoryById(it.categoryId);
          return '<div class="cat-row" style="padding:8px 0">' +
            '<div class="cat-ico" style="width:32px;height:32px;flex:0 0 32px;font-size:15px;background:' + hexA(cat2.color, .16) + '">' + esc(cat2.emoji) + '</div>' +
            '<div class="cat-main"><div class="cat-main__top">' +
              '<span class="cat-main__name" style="font-size:13.5px">' + esc(it.label) + '</span>' +
              '<span class="cat-main__value" style="font-size:13.5px">' + esc(fmt(it.total)) + '</span></div>' +
              '<div class="cat-track"><div class="cat-track__fill" style="width:' + ((it.total / maxItem) * 100).toFixed(1) + '%;background:' + cat2.color + '"></div></div>' +
            '</div></div>';
        }).join('') + '</div>';
    }

    if (total === 0) {
      html += emptyState('📊', 'No history yet',
        'Once you add expenses, this page shows month-by-month totals, category shares and your biggest items.');
    } else {
      html += '<div class="card"><div class="card__title"><span>Jump to a month</span></div>' +
        series.slice().reverse().map(function (m) {
          return '<button type="button" class="set-row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line-soft);text-align:left;cursor:pointer" ' +
            'data-action="open-month" data-month="' + esc(m.month) + '">' +
            '<div class="set-row__main"><div class="set-row__name">' + esc(S.monthName(m.month)) + '</div>' +
            '<div class="set-row__sub">' + (m.total > 0 ? Math.round((m.total / (total || 1)) * 100) + '% of period' : 'no spending') + '</div></div>' +
            '<div class="set-row__value" style="font-weight:650;font-variant-numeric:tabular-nums">' + esc(fmt(m.total)) + '</div>' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-mute);flex:0 0 16px" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
          '</button>';
        }).join('') + '</div>';
    }

    $('#historyContent').innerHTML = html;
    drawHistoryCharts(series, cat);
  }

  function drawHistoryCharts(series, cat) {
    destroyChart('trend');
    destroyChart('cat');
    if (!window.Chart) return;

    var textDim = cssVar('--text-dim') || '#9aa7c2';
    var line = cssVar('--line-soft') || '#1b2438';
    var font = { family: cssVar('--font') || 'sans-serif', size: 11 };

    Chart.defaults.color = textDim;
    Chart.defaults.font.family = font.family;

    var trendEl = document.getElementById('trendChart');
    if (trendEl) {
      charts.trend = new Chart(trendEl, {
        type: 'bar',
        data: {
          labels: series.map(function (m) { return S.shortMonthName(m.month); }),
          datasets: [{
            data: series.map(function (m) { return m.total; }),
            backgroundColor: series.map(function (m) {
              return m.month === S.currentMonth() ? '#6f8ef7' : 'rgba(79,156,249,.45)';
            }),
            borderRadius: 7,
            borderSkipped: false,
            maxBarThickness: 34
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 380 },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) { return fmt(ctx.parsed.y); }
              }
            }
          },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { font: font } },
            y: {
              beginAtZero: true,
              border: { display: false },
              grid: { color: line, drawTicks: false },
              ticks: {
                font: font, maxTicksLimit: 4, padding: 6,
                callback: function (v) { return fmtShort(v); }
              }
            }
          }
        }
      });
    }

    var catEl = document.getElementById('catChart');
    if (catEl && cat.rows.length) {
      charts.cat = new Chart(catEl, {
        type: 'doughnut',
        data: {
          labels: cat.rows.map(function (r) { return r.category.name; }),
          datasets: [{
            data: cat.rows.map(function (r) { return r.total; }),
            backgroundColor: cat.rows.map(function (r) { return r.category.color; }),
            borderWidth: 0,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '64%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var total = ctx.dataset.data.reduce(function (a, b) { return a + b; }, 0) || 1;
                  return ctx.label + ': ' + fmt(ctx.parsed) + ' (' + Math.round((ctx.parsed / total) * 100) + '%)';
                }
              }
            }
          }
        }
      });
    }
  }

  /* ── PLANS ─────────────────────────────────────────────────── */

  function renderPlans() {
    var plans = S.plans();
    var summary = S.plansActiveSummary();
    var ym = S.currentMonth();
    var active = plans.filter(function (p) { return !p.status.finished; });
    var done = plans.filter(function (p) { return p.status.finished; });

    var html = '';

    if (!plans.length) {
      html += emptyState('💳', 'No installment plans',
        'When you add an expense and pay by card, switch on "Split into installments" to spread it over 2–60 months. Each month only its share counts towards your spending.');
      html += '<button type="button" class="btn btn--primary btn--block" data-action="add-expense">Add a card purchase</button>';
      $('#plansContent').innerHTML = html;
      return;
    }

    html += '<div class="hero">' +
      '<div class="hero__label">Still to pay</div>' +
      '<div class="hero__amount">' + esc(fmt(summary.remaining)) + '</div>' +
      '<div class="hero__meta">' + summary.active + (summary.active === 1 ? ' active plan' : ' active plans') + ' · on ' + esc(fmt(summary.total)) + ' of purchases</div>' +
      '<div class="hero__split">' +
        '<div><div class="mini-stat__label">This month</div><div class="mini-stat__value">' + esc(fmt(summary.monthly)) + '</div></div>' +
        '<div><div class="mini-stat__label">Already paid</div><div class="mini-stat__value">' + esc(fmt(summary.total - summary.remaining)) + '</div></div>' +
      '</div></div>';

    if (active.length) {
      html += '<h2 class="view-head__title" style="font-size:15px;color:var(--text-dim)">Active</h2>';
      html += active.map(function (p) { return planCard(p, ym); }).join('');
    }
    if (done.length) {
      html += '<h2 class="view-head__title" style="font-size:15px;color:var(--text-dim)">Finished</h2>';
      html += done.map(function (p) { return planCard(p, ym); }).join('');
    }
    html += '<button type="button" class="btn btn--primary btn--block" data-action="add-expense">Add a card purchase</button>';

    $('#plansContent').innerHTML = html;
  }

  function planCard(p, ym) {
    var e = p.expense;
    var st = p.status;
    var cat = S.categoryById(e.categoryId);
    var paidShare = st.months ? (st.paidCount / st.months) * 100 : 0;
    var pips = st.parts.map(function (part, i) {
      var cls = i < st.paidCount ? 'pip pip--done' : (i === st.paidCount && !st.finished ? 'pip pip--now' : 'pip');
      return '<span class="' + cls + '" title="' + esc(S.shortMonthName(S.addMonths(st.startMonth, i))) + ' ' + esc(fmt(part)) + '"></span>';
    }).join('');

    return '<button type="button" class="card plan-card" data-action="open-plan" data-id="' + esc(e.id) + '" ' +
      'style="text-align:left;cursor:pointer;width:100%">' +
      '<div class="plan-card__top">' +
        '<span class="cat-ico" style="background:' + hexA(cat.color, .16) + '">' + esc(cat.emoji) + '</span>' +
        '<span class="plan-card__head">' +
          '<span class="plan-card__name" style="display:block">' + esc(e.note || cat.name) + '</span>' +
          '<span class="plan-card__sub">' + esc(cat.name) + ' · ' + st.months + ' months · ' +
            esc(fmt(st.monthly)) + '/month</span>' +
        '</span>' +
        '<span class="exp__right">' +
          '<span class="plan-card__total">' + esc(fmt(e.amount)) + '</span><br>' +
          (st.finished
            ? '<span class="badge badge--good">Paid off</span>'
            : '<span class="badge badge--warn">' + st.remainingCount + ' left</span>') +
        '</span>' +
      '</div>' +
      '<div class="pips" aria-hidden="true">' + pips + '</div>' +
      '<div class="plan-card__foot"><span>' + st.paidCount + ' of ' + st.months + ' paid · ' + Math.round(paidShare) + '%</span>' +
        '<span>' + (st.finished ? 'ends ' + esc(S.shortMonthName(st.endMonth)) : esc(fmt(st.remaining)) + ' remaining') + '</span></div>' +
    '</button>';
  }

  function openPlanSheet(id) {
    var e = S.expenseById(id);
    if (!e) return;
    var st = S.planStatus(e, S.currentMonth());
    if (!st) return;
    var cat = S.categoryById(e.categoryId);
    var ym = S.currentMonth();

    var rows = st.parts.map(function (part, i) {
      var m = S.addMonths(st.startMonth, i);
      var isPast = S.monthIndex(m) < S.monthIndex(ym);
      var isNow = m === ym;
      var state = isPast ? 'paid' : (isNow ? 'due' : 'upcoming');
      var stateLabel = isPast ? 'Paid' : isNow ? 'This month' : 'Upcoming';
      var color = isPast ? 'var(--good)' : isNow ? 'var(--warn)' : 'var(--text-mute)';
      return '<div class="set-row" style="padding:9px 0">' +
        '<div class="set-row__main"><div class="set-row__name" style="font-size:14px">' + esc(S.monthName(m)) + '</div>' +
        '<div class="set-row__sub">Installment ' + (i + 1) + ' of ' + st.months + '</div></div>' +
        '<div style="text-align:right"><div style="font-weight:650;font-variant-numeric:tabular-nums">' + esc(fmt(part)) + '</div>' +
        '<div style="font-size:11px;color:' + color + ';font-weight:600">' + stateLabel + '</div></div>' +
      '</div>';
    }).join('');

    $('#planBody').innerHTML =
      '<div class="sheet__head">' +
        '<h2 class="sheet__title">' + esc(e.note || cat.name) + '</h2>' +
        '<button type="button" class="icon-btn icon-btn--flat" data-close-sheet aria-label="Close">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="inset">' +
        '<div class="plan-card__top">' +
          '<span class="cat-ico" style="background:' + hexA(cat.color, .16) + '">' + esc(cat.emoji) + '</span>' +
          '<span class="plan-card__head">' +
            '<span class="plan-card__name">Total ' + esc(fmt(e.amount)) + '</span>' +
            '<span class="plan-card__sub">' + esc(cat.name) + ' · bought ' + esc(S.formatDate(e.date)) + ' · ' + st.months + ' months</span>' +
          '</span>' +
        '</div>' +
        '<div class="plan-card__foot"><span>' + esc(fmt(st.monthly)) + ' per month</span>' +
          '<span>' + (st.finished ? 'Paid off' : esc(fmt(st.remaining)) + ' remaining') + '</span></div>' +
      '</div>' +
      '<div class="card__title" style="margin-bottom:2px"><span>Schedule</span><span>' + esc(S.shortMonthName(st.startMonth)) + ' ' + st.startMonth.slice(0, 4) + ' – ' + esc(S.shortMonthName(st.endMonth)) + ' ' + st.endMonth.slice(0, 4) + '</span></div>' +
      '<div>' + rows + '</div>' +
      '<div class="sheet__actions">' +
        '<button type="button" class="btn btn--danger-ghost" data-action="delete-expense" data-id="' + esc(e.id) + '">Delete plan</button>' +
        '<button type="button" class="btn" data-action="edit-expense" data-id="' + esc(e.id) + '">Edit</button>' +
      '</div>';

    openSheet('sheet-plan');
  }

  /* ── SETTINGS ──────────────────────────────────────────────── */

  function renderSettings() {
    var s = S.settings();
    var stats = S.stats();
    var cats = S.categories();
    var syncOn = !!(window.BudgetSync && window.BudgetSync.isConfigured() && window.BudgetSync.isSignedIn());

    var html = '';

    /* money settings */
    html += '<div class="card"><div class="card__title"><span>Money</span></div>' +
      '<label class="field"><span class="field__label">Currency</span>' +
        '<select id="setCurrency" aria-label="Currency">' +
          CURRENCIES.map(function (c) {
            return '<option value="' + c[0] + '"' + (c[0] === s.currency ? ' selected' : '') + '>' +
              c[1] + ' — ' + c[0] + ' · ' + c[2] + '</option>';
          }).join('') +
        '</select>' +
      '</label>' +
      '<label class="field" style="margin-top:12px"><span class="field__label">Monthly budget <span class="field__hint">(optional)</span></span>' +
        '<input id="setBudget" type="text" inputmode="decimal" value="' + esc(Number(s.totalBudget) > 0 ? s.totalBudget : '') + '" placeholder="e.g. 1500" aria-label="Monthly budget">' +
      '</label>' +
      '<p class="field__hint field__hint--block" style="margin-top:8px">Shown as a progress bar on the home screen. Leave empty to hide it.</p>' +
    '</div>';

    /* categories */
    html += '<div class="card"><div class="card__title"><span>Categories</span>' +
      '<span><button type="button" class="monthbar__jump" data-action="new-category">+ add</button></span></div>' +
      cats.map(function (c) {
        var rowTotal = 0;
        S.get().expenses.forEach(function (e) { if (e.categoryId === c.id) rowTotal += e.amount; });
        return '<button type="button" class="set-row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line-soft);text-align:left;cursor:pointer" ' +
          'data-action="edit-category" data-id="' + esc(c.id) + '">' +
          '<span class="cat-ico" style="width:34px;height:34px;flex:0 0 34px;font-size:16px;background:' + hexA(c.color, .16) + '">' + esc(c.emoji) + '</span>' +
          '<span class="set-row__main"><span class="set-row__name" style="display:block">' + esc(c.name) + '</span>' +
          '<span class="set-row__sub">' + (Number(c.budget) > 0 ? 'limit ' + esc(fmt(c.budget)) + '/mo · ' : '') +
            esc(fmt(rowTotal)) + ' all time</span></span>' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-mute);flex:0 0 16px" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
        '</button>';
      }).join('') +
      '<button type="button" class="btn btn--ghost btn--block btn--sm" style="margin-top:12px" data-action="new-category">Add category</button>' +
    '</div>';

    /* sync (optional, free Firebase account) */
    html += syncCardHtml();

    /* data */
    html += '<div class="card"><div class="card__title"><span>Your data</span><span>' +
      stats.expenses + ' expenses · ' + stats.plans + ' plans</span></div>' +
      '<p class="field__hint" style="margin:0 0 12px">' +
        (syncOn ? 'Backed up to your own Firebase account, and still cached in this browser so the app works offline.'
                : 'Everything is stored in this browser only — no account, nothing uploaded. Back it up before changing phone or clearing browser data.') +
      '</p>' +
      '<div class="set-actions">' +
        '<button type="button" class="btn btn--block" data-action="export">Download backup (.json)</button>' +
        '<button type="button" class="btn btn--block" data-action="import">Restore from backup</button>' +
        '<input type="file" id="importFile" accept="application/json,.json" hidden>' +
      '</div>' +
    '</div>';

    /* appearance + about */
    html += '<div class="card"><div class="card__title"><span>Appearance</span></div>' +
      '<div class="segmented segmented--wide" id="themeSwitch" role="group" aria-label="Theme">' +
        '<button type="button" data-action="theme" data-theme-value="dark" class="' + (document.documentElement.getAttribute('data-theme') !== 'light' ? 'is-active' : '') + '">Dark</button>' +
        '<button type="button" data-action="theme" data-theme-value="light" class="' + (document.documentElement.getAttribute('data-theme') === 'light' ? 'is-active' : '') + '">Light</button>' +
      '</div>' +
      '<p class="field__hint" style="margin:10px 0 0">Add this page to your Android home screen from the browser menu to use it like an app, offline.</p>' +
    '</div>';

    html += '<div class="card"><div class="card__title"><span>Danger zone</span></div>' +
      '<button type="button" class="btn btn--danger-ghost btn--block" data-action="reset">Delete all data</button>' +
      '<p class="field__hint" style="margin:10px 0 0">Removes every expense, plan and category from this browser. Download a backup first if you might need it.</p>' +
    '</div>';

    html += '<p class="field__hint" style="text-align:center;margin:4px 0 8px">Household Budget · v1 · works offline</p>';

    $('#settingsContent').innerHTML = html;

    var cur = $('#setCurrency');
    if (cur) cur.addEventListener('change', function () {
      var found = CURRENCIES.filter(function (c) { return c[0] === cur.value; })[0];
      S.updateSettings({ currency: cur.value, symbol: found ? found[1] : '$' });
      toast('Currency set to ' + cur.value);
      renderAll();
    });

    var bud = $('#setBudget');
    if (bud) bud.addEventListener('change', function () {
      var v = S.parseAmount(bud.value);
      S.updateSettings({ totalBudget: isFinite(v) && v > 0 ? S.round2(v) : null });
      toast(isFinite(v) && v > 0 ? 'Monthly budget saved' : 'Monthly budget removed');
      renderSettings();
      renderHome();
    });

    var file = $('#importFile');
    if (file) file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var mode = window.confirm(
          'Restore from backup?\n\nOK = replace everything with the backup.\nCancel = keep my data and merge the backup into it.'
        );
        var res = S.importJSON(String(reader.result), !mode);
        if (!res.ok) { toast(res.reason || 'Could not restore that file'); return; }
        toast(res.replaced ? 'Backup restored' : 'Merged ' + res.added + ' expense(s)');
        renderAll();
      };
      reader.readAsText(f);
      file.value = '';
    });
  }

  /* ── EXPENSE SHEET ─────────────────────────────────────────── */

  function buildCategoryChips(selected) {
    var box = $('#fCategoryChips');
    box.innerHTML = S.categories().map(function (c) {
      return '<button type="button" class="chip" role="radio" aria-checked="' + (c.id === selected ? 'true' : 'false') + '" ' +
        'data-cat="' + esc(c.id) + '" style="--chip-color:' + c.color + '">' +
        '<span class="chip__dot" style="background:' + hexA(c.color, .22) + '" aria-hidden="true">' + esc(c.emoji) + '</span>' +
        esc(c.name) + '</button>';
    }).join('');
  }

  function setFormMethod(method) {
    ui.form.method = method;
    $$('#fMethod button').forEach(function (b) {
      var on = b.getAttribute('data-method') === method;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var isCredit = method === 'credit';
    $('#installmentBlock').hidden = !isCredit;
    if (!isCredit) {
      $('#fInstallToggle').checked = false;
      $('#installmentConfig').hidden = true;
    }
    $('#methodHint').textContent = isCredit
      ? 'Card purchases can be split into monthly installments.'
      : 'Only the months it is charged in count towards your spending.';
    updateMonthlyPreview();
  }

  function updateMonthlyPreview() {
    var amount = S.parseAmount($('#fAmount').value);
    var months = parseInt($('#fMonths').value, 10) || 3;
    var el = $('#fMonthlyPreview');
    var on = $('#fInstallToggle').checked;
    $('#installmentConfig').hidden = !on;
    if (!on) { el.textContent = ''; return; }
    if (!isFinite(amount) || amount <= 0) {
      el.innerHTML = 'Enter the total amount to see the monthly split.';
      return;
    }
    var parts = S.splitAmount(amount, months);
    var last = parts[parts.length - 1];
    var first = parts[0];
    el.innerHTML = months + ' payments of <strong>' + esc(fmt(first)) + '</strong>' +
      (Math.abs(last - first) > 0.004 ? ' (last one <strong>' + esc(fmt(last)) + '</strong>)' : '') +
      ' — first charge in <strong>' + esc(S.monthName(S.monthOf($('#fDate').value || S.todayStr()))) + '</strong>.';
  }

  function openExpenseSheet(expense) {
    var e = expense || null;
    ui.form.editingId = e ? e.id : null;
    $('#expenseTitle').textContent = e ? 'Edit expense' : 'Add expense';
    $('#saveExpenseBtn').textContent = e ? 'Save changes' : 'Save expense';
    $('#deleteExpenseBtn').hidden = !e;

    $('#fAmount').value = e ? e.amount.toFixed(2) : '';
    $('#fNote').value = e ? e.note : '';
    $('#fDate').value = e ? e.date : (ui.month === S.currentMonth() ? S.todayStr() : ui.month + '-01');
    $('#formCurrency').textContent = symbol();

    var catId = e ? e.categoryId : (ui.form.categoryId || S.categories()[0].id);
    ui.form.categoryId = catId;
    buildCategoryChips(catId);

    setFormMethod(e ? e.method : 'cash');
    var months = e && e.months >= 2 ? e.months : 3;
    $('#fMonths').value = months;
    $('#fInstallToggle').checked = !!(e && e.months >= 2);
    $('#installmentConfig').hidden = !$('#fInstallToggle').checked;
    $('#fAmountError').hidden = true;
    updateMonthlyPreview();

    // Rebuild note suggestions from history.
    var seen = {};
    var notes = [];
    S.expensesSorted().forEach(function (x) {
      var n = (x.note || '').trim();
      if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = true; notes.push(n); }
    });
    $('#noteHistory').innerHTML = notes.slice(0, 60).map(function (n) {
      return '<option value="' + esc(n) + '"></option>';
    }).join('');

    openSheet('sheet-expense');
    setTimeout(function () { $('#fAmount').focus(); }, 120);
  }

  function submitExpense(ev) {
    ev.preventDefault();
    var amount = S.parseAmount($('#fAmount').value);
    if (!isFinite(amount) || amount <= 0) {
      $('#fAmountError').hidden = false;
      $('#fAmount').focus();
      return;
    }
    var installOn = $('#fInstallToggle').checked && ui.form.method === 'credit';
    var payload = {
      amount: amount,
      categoryId: ui.form.categoryId || S.categories()[0].id,
      note: $('#fNote').value,
      date: $('#fDate').value || S.todayStr(),
      method: ui.form.method,
      months: installOn ? parseInt($('#fMonths').value, 10) || 3 : 0
    };
    if (payload.months && (payload.months < 2 || payload.months > 60)) {
      toast('Choose between 2 and 60 installments');
      return;
    }

    var saved;
    if (ui.form.editingId) saved = S.updateExpense(ui.form.editingId, payload);
    else saved = S.addExpense(payload);

    if (!saved) { toast('Could not save that expense'); return; }

    ui.month = S.monthOf(saved.date);
    closeSheet();
    renderMonthLabel();
    renderHome();
    if (ui.view === 'history') renderHistory();
    if (ui.view === 'plans') renderPlans();
    toast(ui.form.editingId ? 'Expense updated' : (payload.months ? 'Plan saved · ' + payload.months + ' months' : 'Expense saved'));
    ui.form.editingId = null;
  }

  /* ── CATEGORY SHEET ────────────────────────────────────────── */

  var catEditingId = null;

  function buildSwatches(selected) {
    var box = $('#cColors');
    box.innerHTML = PALETTE.map(function (color) {
      return '<button type="button" class="swatch" role="radio" aria-checked="' + (color === selected ? 'true' : 'false') + '" ' +
        'data-color="' + color + '" style="background:' + color + '" aria-label="Colour ' + color + '"></button>';
    }).join('');
  }

  function openCategorySheet(id) {
    catEditingId = id || null;
    var existing = id ? S.categories().filter(function (c) { return c.id === id; })[0] : null;
    $('#categoryTitle').textContent = existing ? 'Edit category' : 'New category';
    $('#cName').value = existing ? existing.name : '';
    $('#cEmoji').value = existing ? existing.emoji : '';
    $('#cBudget').value = existing && Number(existing.budget) > 0 ? existing.budget : '';
    $('#deleteCategoryBtn').hidden = !existing;
    buildSwatches(existing ? existing.color : PALETTE[S.categories().length % PALETTE.length]);
    openSheet('sheet-category');
    setTimeout(function () { $('#cName').focus(); }, 120);
  }

  function submitCategory(ev) {
    ev.preventDefault();
    var name = $('#cName').value.trim();
    if (!name) { toast('Give the category a name'); $('#cName').focus(); return; }
    var color = ($('#cColors [aria-checked="true"]') || {}).getAttribute
      ? $('#cColors [aria-checked="true"]').getAttribute('data-color')
      : PALETTE[0];
    var budget = S.parseAmount($('#cBudget').value);
    var data = {
      name: name,
      emoji: $('#cEmoji').value.trim() || '🏷️',
      color: color,
      budget: isFinite(budget) && budget > 0 ? S.round2(budget) : null
    };
    if (catEditingId) {
      S.updateCategory(catEditingId, data);
      toast('Category updated');
    } else {
      S.addCategory(data);
      toast('Category added');
    }
    closeSheet();
    renderAll();
  }

  /* ── sheet plumbing ────────────────────────────────────────── */

  function openSheet(id) {
    closeSheet(true);
    ui.sheetOpen = id;
    $('#sheet-expense').hidden = id !== 'sheet-expense';
    $('#sheet-category').hidden = id !== 'sheet-category';
    $('#sheet-plan').hidden = id !== 'sheet-plan';
    $('.sheet-backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
    var sheet = document.getElementById(id);
    if (sheet) sheet.scrollTop = 0;

    // Focus trap for accessibility.
    var focusable = $$('button, input, select, [tabindex]', sheet).filter(function (n) {
      return !n.disabled && n.offsetParent !== null;
    });
    if (focusable.length) focusable[0].focus({ preventScroll: true });
  }

  function closeSheet(quiet) {
    if (!quiet && !ui.sheetOpen) return;
    ui.sheetOpen = null;
    $('#sheet-expense').hidden = true;
    $('#sheet-category').hidden = true;
    $('#sheet-plan').hidden = true;
    $('.sheet-backdrop').hidden = true;
    document.body.style.overflow = '';
    if (!quiet) ui.form.editingId = null;
  }

  /* ── events ────────────────────────────────────────────────── */

  function bindEvents() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { setView(tab.getAttribute('data-view')); });
    });

    $('#themeBtn').addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      S.updateSettings({ theme: next });
      applyTheme(next);
      renderSettingsIfActive();
      if (ui.view === 'history') renderHistory();
    });

    $('#addBtn').addEventListener('click', function () { openExpenseSheet(null); });

    $$('[data-month-step]').forEach(function (btn) {
      btn.addEventListener('click', function () { stepMonth(parseInt(btn.getAttribute('data-month-step'), 10)); });
    });

    $('#monthJump').addEventListener('click', function () {
      ui.month = S.currentMonth();
      renderMonthLabel();
      renderHome();
    });

    /* delegated clicks */
    document.addEventListener('click', function (ev) {
      var closer = ev.target.closest('[data-close-sheet]');
      if (closer) { closeSheet(); return; }

      var target = ev.target.closest('[data-action]');
      if (target) {
        var action = target.getAttribute('data-action');
        if (action === 'add-expense') { openExpenseSheet(null); return; }
        if (action === 'edit-expense') {
          ev.stopPropagation();
          var id = target.getAttribute('data-id');
          closeSheet(true);
          openExpenseSheet(S.expenseById(id));
          return;
        }
        if (action === 'delete-expense') {
          var did = target.getAttribute('data-id');
          var ex = S.expenseById(did);
          if (ex && window.confirm('Delete "' + (ex.note || S.categoryById(ex.categoryId).name) + '"? This cannot be undone.')) {
            S.deleteExpense(did);
            closeSheet();
            renderAll();
            toast('Expense deleted');
          }
          return;
        }
        if (action === 'open-plan') { openPlanSheet(target.getAttribute('data-id')); return; }
        if (action === 'goto-history') { setView('history'); return; }
        if (action === 'range') {
          ui.historyRange = parseInt(target.getAttribute('data-range'), 10) || 6;
          renderHistory();
          return;
        }
        if (action === 'open-month') {
          ui.month = target.getAttribute('data-month');
          renderMonthLabel();
          setView('home');
          return;
        }
        if (action === 'new-category') { openCategorySheet(null); return; }
        if (action === 'edit-category') { openCategorySheet(target.getAttribute('data-id')); return; }
        if (action === 'theme') {
          var t = target.getAttribute('data-theme-value');
          S.updateSettings({ theme: t });
          applyTheme(t);
          renderSettingsIfActive();
          if (ui.view === 'history') renderHistory();
          return;
        }
        if (action === 'export') {
          var blob = new Blob([S.exportJSON()], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'budget-backup-' + S.todayStr() + '.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
          toast('Backup downloaded');
          return;
        }
        if (action === 'import') {
          var fi = $('#importFile');
          if (fi) fi.click();
          return;
        }
        if (action === 'sync-save-config') {
          var ta = $('#syncConfigText');
          var parsed = window.BudgetSync.parseConfigText(ta ? ta.value : '');
          if (!parsed.ok) { toast(parsed.reason); return; }
          window.BudgetSync.setConfig(parsed.config);
          renderSettings();
          toast('Config saved — now sign in');
          return;
        }
        if (action === 'sync-forget-config') {
          if (window.confirm('Forget this Firebase config? Your local data is not touched, and nothing is deleted from Firebase.')) {
            window.BudgetSync.clearConfig();
            renderSettings();
            toast('Firebase config removed');
          }
          return;
        }
        if (action === 'sync-signup' || action === 'sync-signin') {
          var emailEl = $('#syncEmail');
          var passEl = $('#syncPassword');
          var email = emailEl ? emailEl.value.trim() : '';
          var pass = passEl ? passEl.value : '';
          if (!email || !pass) { toast('Enter both email and password'); return; }
          var btnEl = target;
          btnEl.disabled = true;
          var isSignup = action === 'sync-signup';
          var call = isSignup ? window.BudgetSync.signUp(email, pass) : window.BudgetSync.signIn(email, pass);
          call.then(function () {
            startSyncEngine();
            return window.BudgetSync.syncNow();
          }).then(function () {
            afterSyncChange(isSignup ? 'Account created — syncing now' : 'Signed in — syncing now');
          }).catch(function (err) {
            toast(err.message || 'Sign-in failed');
            if (btnEl) btnEl.disabled = false;
          });
          return;
        }
        if (action === 'sync-now') { runSync(false); return; }
        if (action === 'sync-signout') {
          if (window.confirm('Sign out of sync? Your data stays on this device and remains in Firebase.')) {
            window.BudgetSync.signOut();
            renderSettings();
            toast('Signed out of sync');
          }
          return;
        }
        if (action === 'reset') {
          if (window.confirm('Delete every expense, plan and category from this browser?\n\nThis cannot be undone. Download a backup first if unsure.')) {
            S.resetAll();
            ui.month = S.currentMonth();
            renderAll();
            toast('All data deleted');
          }
          return;
        }
      }

      /* category chips */
      var chip = ev.target.closest('[data-cat]');
      if (chip) {
        ui.form.categoryId = chip.getAttribute('data-cat');
        $$('#fCategoryChips .chip').forEach(function (c) {
          c.setAttribute('aria-checked', c === chip ? 'true' : 'false');
        });
        return;
      }

      /* colour swatches */
      var sw = ev.target.closest('[data-color]');
      if (sw) {
        $$('#cColors .swatch').forEach(function (s) {
          s.setAttribute('aria-checked', s === sw ? 'true' : 'false');
        });
        return;
      }
    });

    $('#fMethod').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-method]');
      if (b) setFormMethod(b.getAttribute('data-method'));
    });

    $('#fInstallToggle').addEventListener('change', function () {
      $('#installmentConfig').hidden = !this.checked;
      updateMonthlyPreview();
    });

    $$('.stepper__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = $('#fMonths');
        var val = (parseInt(input.value, 10) || 3) + parseInt(btn.getAttribute('data-step'), 10);
        input.value = Math.max(2, Math.min(60, val));
        updateMonthlyPreview();
      });
    });

    $('#fMonths').addEventListener('input', updateMonthlyPreview);
    $('#fAmount').addEventListener('input', function () {
      $('#fAmountError').hidden = true;
      updateMonthlyPreview();
    });
    $('#fDate').addEventListener('change', updateMonthlyPreview);

    $('#expenseForm').addEventListener('submit', submitExpense);
    $('#categoryForm').addEventListener('submit', submitCategory);

    $('#deleteExpenseBtn').addEventListener('click', function () {
      var id = ui.form.editingId;
      if (!id) return;
      if (window.confirm('Delete this expense? This cannot be undone.')) {
        S.deleteExpense(id);
        closeSheet();
        renderAll();
        toast('Expense deleted');
      }
    });

    $('#deleteCategoryBtn').addEventListener('click', function () {
      if (!catEditingId) return;
      var cat = S.categories().filter(function (c) { return c.id === catEditingId; })[0];
      if (!cat) return;
      if (!window.confirm('Delete the category "' + cat.name + '"?\n\nIts expenses are kept and moved to another category.')) return;
      var res = S.deleteCategory(catEditingId);
      if (!res.ok) { toast('You need at least one category'); return; }
      closeSheet();
      renderAll();
      toast(res.moved ? res.moved + ' expense(s) moved to ' + res.fallbackName : 'Category deleted');
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && ui.sheetOpen) closeSheet();
      if (ev.key === 'ArrowLeft' && ui.view === 'home' && !ui.sheetOpen) stepMonth(-1);
      if (ev.key === 'ArrowRight' && ui.view === 'home' && !ui.sheetOpen) stepMonth(1);
    });

    /* keep charts readable when the phone rotates or resizes */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (ui.view === 'history') renderHistory(); }, 260);
    });
  }

  function renderSettingsIfActive() {
    if (ui.view === 'settings') renderSettings();
  }

  /* ── SYNC CARD (optional free Firebase) ────────────────────── */

  function syncCardHtml() {
    var Sync = window.BudgetSync;
    var st = Sync ? Sync.status() : { configured: false, signedIn: false };

    var body = '';

    if (!st.configured) {
      body +=
        '<p class="field__hint" style="margin:0 0 10px">Optional. Add a free Firebase Realtime Database so your PC and phone share one budget automatically. Without it, each device keeps its own copy and you move data with backups.</p>' +
        '<p class="field__hint" style="margin:0 0 10px">You only need two values. Find the <strong style="color:var(--text)">Web API Key</strong> under Project settings &rarr; General, and the <strong style="color:var(--text)">Database URL</strong> at the top of Build &rarr; Realtime Database. Copy the database URL exactly &mdash; it may end in <code>firebasedatabase.app</code>.</p>' +
        '<label class="field"><span class="field__label">Firebase key &amp; database URL</span>' +
          '<textarea id="syncConfigText" rows="4" placeholder="apiKey: &quot;AIza...&quot;\ndatabaseURL: &quot;https://your-project-default-rtdb.firebaseio.com&quot;" ' +
          'style="width:100%;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:11px 12px;outline:none;resize:vertical;font-family:ui-monospace,monospace;font-size:12px"></textarea></label>' +
        '<p class="field__hint" style="margin:8px 0 0">The whole <code>firebaseConfig = { ... }</code> block works too, if you can find it.</p>' +
        '<button type="button" class="btn btn--block btn--sm" style="margin-top:10px" data-action="sync-save-config">Save config</button>';
    } else if (!st.signedIn) {
      body +=
        '<p class="field__hint" style="margin:0 0 12px">Config saved. Now create an account (or sign in to the one you already made on your other device). Use the same account on every device.</p>' +
        '<label class="field"><span class="field__label">Email</span>' +
          '<input id="syncEmail" type="email" autocomplete="username" placeholder="you@example.com"></label>' +
        '<label class="field" style="margin-top:10px"><span class="field__label">Password</span>' +
          '<input id="syncPassword" type="password" autocomplete="current-password" placeholder="At least 6 characters"></label>' +
        '<div class="set-actions" style="margin-top:12px">' +
          '<button type="button" class="btn btn--primary btn--block" data-action="sync-signin">Sign in</button>' +
          '<button type="button" class="btn btn--block" data-action="sync-signup">Create account</button>' +
          '<button type="button" class="btn btn--ghost btn--block btn--sm" data-action="sync-forget-config">Use a different Firebase project</button>' +
        '</div>';
    } else {
      var u = st.user || {};
      body +=
        '<p class="field__hint" style="margin:0 0 12px">Signed in as <strong style="color:var(--text)">' + esc(u.email || u.uid) + '</strong>. ' +
        'Changes sync between your devices within a few seconds — and everything still works offline.</p>' +
        '<div class="set-row" style="padding:6px 0">' +
          '<div class="set-row__main"><div class="set-row__name" style="font-size:13.5px">Status</div>' +
          '<div class="set-row__sub">' + (st.error ? esc(st.error) : 'Synced') + '</div></div>' +
          '<span class="badge ' + (st.error ? 'badge--over' : 'badge--good') + '">' + (st.error ? 'Problem' : 'Active') + '</span>' +
        '</div>' +
        '<div class="set-actions" style="margin-top:10px">' +
          '<button type="button" class="btn btn--block btn--sm" data-action="sync-now">Sync now</button>' +
          '<button type="button" class="btn btn--ghost btn--block btn--sm" data-action="sync-signout">Sign out</button>' +
        '</div>';
    }

    var badge = st.signedIn
      ? '<span class="badge badge--good">On</span>'
      : (st.configured ? '<span class="badge badge--warn">Set up</span>' : '<span class="badge">Off</span>');

    return '<div class="card"><div class="card__title"><span>Sync across devices</span>' + badge + '</div>' + body + '</div>';
  }

  function afterSyncChange(msg) {
    toast(msg);
    renderSettings();
    renderAll();
  }

  function runSync(silent) {
    var Sync = window.BudgetSync;
    if (!Sync) return;
    if (!silent) toast('Syncing…');
    Sync.syncNow().then(function (res) {
      if (res && res.offline) { toast('Offline — will sync when you reconnect'); return; }
      afterSyncChange(res && res.changed ? 'Synced — brought in changes' : 'Up to date');
    }).catch(function (err) {
      toast(err.message || 'Sync failed');
      renderSettings();
    });
  }

  function renderAll() {
    renderMonthLabel();
    if (ui.view === 'home') renderHome();
    if (ui.view === 'history') renderHistory();
    if (ui.view === 'plans') renderPlans();
    if (ui.view === 'settings') renderSettings();
  }

  /* ── sync engine bootstrap ─────────────────────────────────── */

  var syncStarted = false;

  function startSyncEngine() {
    var Sync = window.BudgetSync;
    if (!Sync || !Sync.isConfigured() || !Sync.isSignedIn()) return;
    // Push on every user edit (debounced inside BudgetSync).
    S.onChange(function () { Sync.schedulePush(); });
    if (syncStarted) return;
    syncStarted = true;
    Sync.startPolling(function () {
      // Remote changes arrived: refresh whatever view is open.
      renderAll();
      toast('Updated from another device');
    });
    // Catch anything that changed while the app was closed.
    Sync.syncNow().then(function (res) {
      if (res && res.changed) renderAll();
    }).catch(function () { /* status shown in Settings; stay quiet on boot */ });
  }

  /* ── boot ──────────────────────────────────────────────────── */

  function init() {
    var s = S.settings();
    applyTheme(s.theme || 'dark');
    ui.month = S.currentMonth();
    renderMonthLabel();
    var initial = String(location.hash || '').replace('#', '');
    setView(VIEWS.indexOf(initial) >= 0 ? initial : 'home', true);
    bindEvents();
    startSyncEngine();

    // Sync again when the connection or the tab comes back.
    window.addEventListener('online', function () {
      if (window.BudgetSync && window.BudgetSync.isSignedIn()) runSync(true);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && window.BudgetSync && window.BudgetSync.isSignedIn()) {
        window.BudgetSync.syncNow().then(function (res) {
          if (res && res.changed) renderAll();
        }).catch(function () {});
      }
    });

    window.addEventListener('hashchange', function () {
      var name = String(location.hash || '').replace('#', '');
      if (VIEWS.indexOf(name) >= 0 && name !== ui.view) setView(name, true);
    });

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache is optional */ });
      });
    }

    // Storage unavailable (private mode / blocked cookies): warn, keep working in memory.
    var st = S.stats();
    if (st.storage === 'memory') {
      setTimeout(function () { toast('Storage is blocked, so changes will not be saved'); }, 800);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

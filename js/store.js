/* Budget — data layer
 * All data lives in localStorage under a single versioned key so it can be
 * exported/imported as one JSON file. Never clear the key on load: unknown or
 * older shapes are migrated in place, and nothing is discarded.
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'household-budget-v1';
  var SCHEMA_VERSION = 1;

  /* ── small date/format helpers ─────────────────────────────── */

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /** Local date as YYYY-MM-DD (avoids UTC off-by-one from toISOString). */
  function toDateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayStr() { return toDateStr(new Date()); }

  /** YYYY-MM from a YYYY-MM-DD string. */
  function monthOf(dateStr) {
    return typeof dateStr === 'string' && dateStr.length >= 7 ? dateStr.slice(0, 7) : '';
  }

  function currentMonth() { return todayStr().slice(0, 7); }

  /** Parse YYYY-MM into {y, m} (m is 1-12). */
  function parseMonth(ym) {
    var parts = String(ym).split('-');
    return { y: parseInt(parts[0], 10) || 1970, m: parseInt(parts[1], 10) || 1 };
  }

  /** Shift a YYYY-MM key by n months (n may be negative). */
  function addMonths(ym, n) {
    var p = parseMonth(ym);
    var total = (p.y * 12) + (p.m - 1) + n;
    var y = Math.floor(total / 12);
    var m = (total % 12 + 12) % 12 + 1;
    return y + '-' + pad(m);
  }

  function monthIndex(ym) {
    var p = parseMonth(ym);
    return p.y * 12 + (p.m - 1);
  }

  function monthName(ym, opts) {
    var p = parseMonth(ym);
    var d = new Date(p.y, p.m - 1, 1);
    try {
      return d.toLocaleDateString(undefined, opts || { month: 'long', year: 'numeric' });
    } catch (e) {
      return ym;
    }
  }

  function shortMonthName(ym) {
    var p = parseMonth(ym);
    var d = new Date(p.y, p.m - 1, 1);
    try {
      return d.toLocaleDateString(undefined, { month: 'short' });
    } catch (e) {
      return ym.slice(5);
    }
  }

  function formatDate(dateStr) {
    var d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr || '';
    try {
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    } catch (e) {
      return dateStr;
    }
  }

  /** "2.5" / "2,5" / "1 200" -> number, or NaN. */
  function parseAmount(value) {
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    var s = String(value == null ? '' : value).trim();
    if (!s) return NaN;
    s = s.replace(/[\s\u00a0']/g, '').replace(/[^\d.,-]/g, '');
    if (s.indexOf(',') > -1 && s.indexOf('.') > -1) {
      // Both present: assume the last one is the decimal separator.
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.indexOf(',') > -1) {
      var dec = s.split(',');
      s = dec.length === 2 && dec[1].length !== 3 ? dec[0] + '.' + dec[1] : s.replace(/,/g, '');
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function uid(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ── defaults ──────────────────────────────────────────────── */

  var C = {
    household: { name: 'Household', emoji: '🏠', color: '#4f9cf9' },
    compulsory: { name: 'Compulsory', emoji: '📌', color: '#f2686b' },
    entertainment: { name: 'Entertainment', emoji: '🎬', color: '#b07bf5' },
    food: { name: 'Food', emoji: '🍽️', color: '#f7a93b' },
    transport: { name: 'Transport', emoji: '🚌', color: '#3fc4a6' },
    health: { name: 'Health', emoji: '❤️', color: '#ff7fa8' },
    other: { name: 'Other', emoji: '🏷️', color: '#8a94a8' }
  };

  var PALETTE = [
    '#4f9cf9', '#f2686b', '#b07bf5', '#f7a93b', '#3fc4a6',
    '#ff7fa8', '#7ed957', '#e9c46a', '#5eead4', '#8a94a8'
  ];

  function defaultCategories() {
    return ['household', 'compulsory', 'entertainment', 'food', 'transport', 'health', 'other']
      .map(function (key, i) {
        return {
          id: key,
          name: C[key].name,
          emoji: C[key].emoji,
          color: C[key].color,
          budget: null,
          order: i
        };
      });
  }

  function defaultState() {
    return {
      version: SCHEMA_VERSION,
      settings: {
        currency: 'USD',
        symbol: '$',
        locale: '',
        theme: 'dark',
        monthStartDay: 1
      },
      categories: defaultCategories(),
      expenses: [],
      // Remote-delete markers: { kind: { id: isoTimestamp } }. Kept out of the
      // display arrays so a delete on one device is not resurrected by another.
      tombstones: { expenses: {}, categories: {} },
      updatedAt: new Date().toISOString()
    };
  }

  /* ── persistence ───────────────────────────────────────────── */

  var state = null;
  var memoryOnly = false;

  function safeGet(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { global.localStorage.setItem(key, value); return true; } catch (e) { memoryOnly = true; return false; }
  }

  /** Repair/migrate whatever shape was found without dropping records. */
  function normalise(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object') return base;

    var out = base;
    out.version = SCHEMA_VERSION;
    out.settings = Object.assign({}, base.settings, raw.settings || {});
    out.createdAt = raw.createdAt || base.updatedAt;
    out.updatedAt = raw.updatedAt || base.updatedAt;

    // Preserve delete markers across load/save and import so a record deleted
    // on one device is not silently restored by another device's copy.
    if (raw.tombstones && typeof raw.tombstones === 'object') {
      out.tombstones = {
        expenses: (raw.tombstones.expenses && typeof raw.tombstones.expenses === 'object') ? raw.tombstones.expenses : {},
        categories: (raw.tombstones.categories && typeof raw.tombstones.categories === 'object') ? raw.tombstones.categories : {}
      };
    }

    // Categories: keep user's list; add the defaults only for a brand-new store.
    if (Array.isArray(raw.categories) && raw.categories.length) {
      var seen = {};
      out.categories = raw.categories.map(function (cat, i) {
        var id = String(cat && cat.id ? cat.id : uid('cat'));
        while (seen[id]) id = uid('cat');
        seen[id] = true;
        return {
          id: id,
          name: cat && cat.name ? String(cat.name) : 'Category',
          emoji: cat && cat.emoji ? String(cat.emoji) : '🏷️',
          color: cat && cat.color ? String(cat.color) : PALETTE[i % PALETTE.length],
          budget: isFinite(parseFloat(cat && cat.budget)) && parseFloat(cat.budget) > 0 ? round2(parseFloat(cat.budget)) : null,
          order: isFinite(cat && cat.order) ? cat.order : i,
          updatedAt: (cat && cat.updatedAt) || (raw.updatedAt || new Date().toISOString())
        };
      }).sort(function (a, b) { return a.order - b.order; });
    } else {
      out.categories = base.categories;
    }
    var known = {};
    out.categories.forEach(function (c) { known[c.id] = true; });
    var fallbackId = out.categories[0].id;

    // Expenses: accept legacy field spellings (value/cat/desc/splits).
    var list = Array.isArray(raw.expenses) ? raw.expenses : (Array.isArray(raw.items) ? raw.items : []);
    out.expenses = list.map(function (e) {
      var amount = parseAmount(e && (e.amount != null ? e.amount : e.value));
      if (!isFinite(amount) || amount <= 0) return null;
      var date = String((e && (e.date || e.day)) || todayStr()).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = todayStr();
      var catId = e && (e.categoryId || e.cat || e.category);
      if (!known[catId]) catId = fallbackId;
      var months = parseInt(e && (e.months || (e.plan && e.plan.months)), 10);
      var created = (e && e.createdAt) || new Date().toISOString();
      return {
        id: e && e.id ? String(e.id) : uid('exp'),
        amount: round2(amount),
        categoryId: catId,
        note: e && (e.note || e.desc || e.description) ? String(e.note || e.desc || e.description).slice(0, 80) : '',
        date: date,
        method: e && /^(cash|debit|credit)$/.test(e.method) ? e.method : 'cash',
        months: months >= 2 && months <= 60 ? months : 0,
        createdAt: created,
        // Per-record timestamp drives cross-device merge (latest write wins).
        updatedAt: (e && e.updatedAt) || created
      };
    }).filter(Boolean);

    return out;
  }

  function load() {
    if (state) return state;
    var raw = safeGet(STORE_KEY);
    var parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    }
    // Keep a one-time backup of anything unreadable so nothing is lost silently.
    if (raw && parsed === null) safeSet(STORE_KEY + '-recovered-' + Date.now(), raw);
    state = normalise(parsed);
    return state;
  }

  /* Fires after a user-driven change so sync can push it. Suppressed while a
   * merge is writing, otherwise merging remote data would trigger a push of the
   * very thing we just pulled (endless ping-pong between devices). */
  var changeHook = null;
  var silentDepth = 0;

  function onChange(fn) { changeHook = typeof fn === 'function' ? fn : null; }

  function withSilence(fn) {
    silentDepth++;
    try { return fn(); } finally { silentDepth--; }
  }

  function save() {
    load();
    state.updatedAt = new Date().toISOString();
    var ok = safeSet(STORE_KEY, JSON.stringify(state));
    if (ok && !silentDepth && changeHook) {
      try { changeHook(); } catch (e) { /* sync must never break saving */ }
    }
    return ok;
  }

  function get() { return load(); }

  /* ── categories ────────────────────────────────────────────── */

  function categories() {
    return load().categories.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function categoryById(id) {
    var cats = load().categories;
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
    return cats[0] || { id: 'other', name: 'Other', emoji: '🏷️', color: '#8a94a8' };
  }

  function addCategory(data) {
    load();
    var cat = {
      id: uid('cat'),
      name: String(data.name || 'Category').slice(0, 24),
      emoji: String(data.emoji || '🏷️').slice(0, 4),
      color: data.color || PALETTE[state.categories.length % PALETTE.length],
      budget: isFinite(parseFloat(data.budget)) && parseFloat(data.budget) > 0 ? round2(parseFloat(data.budget)) : null,
      order: state.categories.length,
      updatedAt: new Date().toISOString()
    };
    state.categories.push(cat);
    save();
    return cat;
  }

  function updateCategory(id, data) {
    load();
    var cat = null;
    state.categories.forEach(function (c) { if (c.id === id) cat = c; });
    if (!cat) return null;
    if (data.name != null) cat.name = String(data.name).slice(0, 24);
    if (data.emoji != null) cat.emoji = String(data.emoji).slice(0, 4);
    if (data.color != null) cat.color = data.color;
    if (data.budget !== undefined) {
      cat.budget = isFinite(parseFloat(data.budget)) && parseFloat(data.budget) > 0 ? round2(parseFloat(data.budget)) : null;
    }
    cat.updatedAt = new Date().toISOString();
    save();
    return cat;
  }

  /**
   * Delete a category. Expenses are never deleted: they are moved to the
   * fallback category (the first remaining one) so no money data disappears.
   */
  function deleteCategory(id) {
    load();
    if (state.categories.length <= 1) return { ok: false, reason: 'last' };
    var target = categoryById(id);
    state.categories = state.categories.filter(function (c) { return c.id !== id; });
    state.tombstones = state.tombstones || { expenses: {}, categories: {} };
    state.tombstones.categories[id] = new Date().toISOString();
    var fallback = state.categories[0].id;
    var moved = 0;
    state.expenses.forEach(function (e) {
      if (e.categoryId === id) { e.categoryId = fallback; moved++; }
    });
    save();
    return { ok: true, fallbackId: fallback, fallbackName: categoryById(fallback).name, moved: moved, name: target.name };
  }

  function moveCategory(id, dir) {
    load();
    var cats = categories();
    var i = -1;
    cats.forEach(function (c, idx) { if (c.id === id) i = idx; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= cats.length) return;
    var tmp = cats[i].order;
    cats[i].order = cats[j].order;
    cats[j].order = tmp;
    if (cats[i].order === cats[j].order) {
      cats.forEach(function (c, idx) { c.order = idx; });
      var swap = cats[i]; cats[i] = cats[j]; cats[j] = swap;
      cats.forEach(function (c, idx) { c.order = idx; });
    }
    state.categories = cats;
    save();
  }

  /* ── expenses ──────────────────────────────────────────────── */

  function addExpense(data) {
    load();
    var amount = parseAmount(data.amount);
    if (!isFinite(amount) || amount <= 0) return null;
    var months = data.method === 'credit' ? parseInt(data.months, 10) : 0;
    if (!(months >= 2 && months <= 60)) months = 0;
    var expense = {
      id: uid('exp'),
      amount: round2(amount),
      categoryId: categoryById(data.categoryId).id,
      note: String(data.note || '').trim().slice(0, 80),
      date: /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : todayStr(),
      method: /^(cash|debit|credit)$/.test(data.method) ? data.method : 'cash',
      months: months,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.expenses.push(expense);
    save();
    return expense;
  }

  function updateExpense(id, data) {
    load();
    var found = null;
    state.expenses.forEach(function (e) { if (e.id === id) found = e; });
    if (!found) return null;
    var amount = parseAmount(data.amount);
    if (isFinite(amount) && amount > 0) found.amount = round2(amount);
    if (data.categoryId != null) found.categoryId = categoryById(data.categoryId).id;
    if (data.note != null) found.note = String(data.note).trim().slice(0, 80);
    if (/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) found.date = data.date;
    if (/^(cash|debit|credit)$/.test(data.method)) found.method = data.method;
    var months = found.method === 'credit' ? parseInt(data.months, 10) : 0;
    found.months = months >= 2 && months <= 60 ? months : 0;
    found.updatedAt = new Date().toISOString();
    save();
    return found;
  }

  function deleteExpense(id) {
    load();
    var before = state.expenses.length;
    state.expenses = state.expenses.filter(function (e) { return e.id !== id; });
    // Leave a marker so another device's copy cannot resurrect this record.
    if (state.expenses.length < before) {
      state.tombstones = state.tombstones || { expenses: {}, categories: {} };
      state.tombstones.expenses[id] = new Date().toISOString();
    }
    save();
    return state.expenses.length < before;
  }

  function expenseById(id) {
    var list = load().expenses;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function expensesSorted() {
    return load().expenses.slice().sort(function (a, b) {
      if (a.date === b.date) return String(b.createdAt).localeCompare(String(a.createdAt));
      return a.date < b.date ? 1 : -1;
    });
  }

  /* ── installments ──────────────────────────────────────────── */

  /**
   * Split an amount over `months` equal parts. The final installment absorbs
   * any rounding remainder so the parts always sum back to the full amount.
   */
  function splitAmount(total, months) {
    var n = Math.max(1, Math.round(months));
    var cents = Math.round(total * 100);
    var base = Math.floor(cents / n);
    var out = [];
    for (var i = 0; i < n; i++) out.push(base / 100);
    out[n - 1] = (cents - base * (n - 1)) / 100;
    return out;
  }

  /**
   * How much a single expense charges to a given YYYY-MM.
   * Cash/debit and single-payment card purchases charge in their own month;
   * installment purchases charge one part in each following month.
   */
  function chargedInMonth(expense, ym) {
    var start = monthOf(expense.date);
    if (!start) return 0;
    var months = expense.months >= 2 ? expense.months : 1;
    var offset = monthIndex(ym) - monthIndex(start);
    if (offset < 0 || offset >= months) return 0;
    if (months === 1) return expense.amount;
    return splitAmount(expense.amount, months)[offset] || 0;
  }

  /** True when the expense still has unpaid installments after the given month. */
  function planStatus(expense, ym) {
    if (!(expense.months >= 2)) return null;
    var start = monthOf(expense.date);
    var done = monthIndex(ym) - monthIndex(start) + 1;
    var paid = Math.min(Math.max(done, 0), expense.months);
    var parts = splitAmount(expense.amount, expense.months);
    var remaining = round2(parts.slice(paid).reduce(function (s, v) { return s + v; }, 0));
    return {
      months: expense.months,
      parts: parts,
      paidCount: paid,
      remainingCount: expense.months - paid,
      remaining: remaining,
      finished: paid >= expense.months,
      startMonth: start,
      endMonth: addMonths(start, expense.months - 1),
      monthly: parts[0]
    };
  }

  /** Every YYYY-MM that has at least one charge (for month navigation). */
  function activeMonths() {
    var set = {};
    load().expenses.forEach(function (e) {
      var n = e.months >= 2 ? e.months : 1;
      var start = monthOf(e.date);
      for (var i = 0; i < n; i++) set[addMonths(start, i)] = true;
    });
    return Object.keys(set).sort();
  }

  /* ── totals & reports ──────────────────────────────────────── */

  function monthTotal(ym) {
    var total = 0;
    load().expenses.forEach(function (e) { total += chargedInMonth(e, ym); });
    return round2(total);
  }

  function monthSummary(ym) {
    var cats = {};
    categories().forEach(function (c) {
      cats[c.id] = { category: c, total: 0, count: 0, paidNow: 0, installments: 0 };
    });
    var total = 0, count = 0, installments = 0, cashTotal = 0, cardTotal = 0;
    var rows = [];

    expensesSorted().forEach(function (e) {
      var charge = chargedInMonth(e, ym);
      if (charge <= 0) return;
      total += charge;
      count++;
      rows.push({ expense: e, charge: charge });
      if (!cats[e.categoryId]) {
        cats[e.categoryId] = { category: categoryById(e.categoryId), total: 0, count: 0, paidNow: 0, installments: 0 };
      }
      cats[e.categoryId].total += charge;
      cats[e.categoryId].count++;
      if (e.months >= 2) installments += charge; else cashTotal += charge;
      if (e.method === 'credit') cardTotal += charge; else cashTotal += (e.months >= 2 ? 0 : 0);
    });

    var list = Object.keys(cats).map(function (k) { return cats[k]; })
      .filter(function (r) { return r.total > 0; })
      .sort(function (a, b) { return b.total - a.total; });

    return {
      month: ym,
      total: round2(total),
      count: count,
      installmentPart: round2(installments),
      rows: rows,
      categories: list.map(function (r) {
        return { category: r.category, total: round2(r.total), count: r.count, share: total ? r.total / total : 0 };
      })
    };
  }

  /** Totals for the last n months, oldest first. */
  function monthlySeries(n, endMonth) {
    var end = endMonth || currentMonth();
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var ym = addMonths(end, -i);
      out.push({ month: ym, total: monthTotal(ym) });
    }
    return out;
  }

  function categoryBreakdown(startMonth, endMonth) {
    var from = startMonth <= endMonth ? startMonth : endMonth;
    var to = startMonth <= endMonth ? endMonth : startMonth;
    var map = {};
    load().expenses.forEach(function (e) {
      var start = monthOf(e.date);
      var months = e.months >= 2 ? e.months : 1;
      for (var i = 0; i < months; i++) {
        var ym = addMonths(start, i);
        if (ym < from || ym > to) continue;
        var part = chargedInMonth(e, ym);
        if (!map[e.categoryId]) map[e.categoryId] = 0;
        map[e.categoryId] += part;
      }
    });
    var total = 0;
    var rows = Object.keys(map).map(function (id) {
      total += map[id];
      return { category: categoryById(id), total: round2(map[id]) };
    }).filter(function (r) { return r.total > 0; })
      .sort(function (a, b) { return b.total - a.total; });
    rows.forEach(function (r) { r.share = total ? r.total / total : 0; });
    return { total: round2(total), rows: rows };
  }

  /** Item/note breakdown for a month range — "what am I spending on?". */
  function noteBreakdown(startMonth, endMonth, limit) {
    var from = startMonth <= endMonth ? startMonth : endMonth;
    var to = startMonth <= endMonth ? endMonth : startMonth;
    var map = {};
    load().expenses.forEach(function (e) {
      var start = monthOf(e.date);
      var months = e.months >= 2 ? e.months : 1;
      for (var i = 0; i < months; i++) {
        var ym = addMonths(start, i);
        if (ym < from || ym > to) continue;
        var key = (e.note || '').trim().toLowerCase() || '(no note)';
        if (!map[key]) map[key] = { label: (e.note || '').trim() || '(no note)', total: 0, count: 0, categoryId: e.categoryId };
        map[key].total += chargedInMonth(e, ym);
        map[key].count++;
      }
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.total - a.total; });
    var sum = rows.reduce(function (s, r) { return s + r.total; }, 0);
    rows = rows.slice(0, limit || rows.length).map(function (r) {
      return { label: r.label, total: round2(r.total), count: r.count, categoryId: r.categoryId, share: sum ? r.total / sum : 0 };
    });
    return rows;
  }

  /** All installment plans, newest first, with their current progress. */
  function plans() {
    return expensesSorted().filter(function (e) { return e.months >= 2; })
      .map(function (e) {
        return { expense: e, status: planStatus(e, currentMonth()) };
      });
  }

  function plansActiveSummary() {
    var ym = currentMonth();
    var monthly = 0, remaining = 0, active = 0, total = 0;
    expensesSorted().forEach(function (e) {
      if (!(e.months >= 2)) return;
      var st = planStatus(e, ym);
      if (st.finished) return;
      active++;
      total += e.amount;
      remaining += st.remaining;
      monthly += st.monthly;
    });
    return { monthly: round2(monthly), remaining: round2(remaining), active: active, total: round2(total) };
  }

  /* ── settings, export / import ─────────────────────────────── */

  function settings() { return load().settings; }

  function updateSettings(patch) {
    load();
    state.settings = Object.assign({}, state.settings, patch || {});
    save();
    return state.settings;
  }

  function exportJSON() {
    load();
    return JSON.stringify({
      app: 'household-budget',
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      categories: state.categories,
      expenses: state.expenses,
      tombstones: state.tombstones
    }, null, 2);
  }

  /**
   * Import a previously exported backup. `merge` keeps current records and adds
   * imported ones that are not already present; otherwise the backup replaces
   * the dataset after the caller confirms.
   */
  function importJSON(text, merge) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, reason: 'That file is not valid JSON.' }; }
    var incoming = normalise(parsed);
    var incomingCount = incoming.expenses.length;
    if (!incomingCount && !(Array.isArray(parsed.categories) && parsed.categories.length)) {
      return { ok: false, reason: 'No expenses found in that file.' };
    }
    load();
    if (merge) {
      var ids = {};
      state.expenses.forEach(function (e) { ids[e.id] = true; });
      var added = 0;
      incoming.expenses.forEach(function (e) {
        if (!ids[e.id]) { state.expenses.push(e); added++; }
      });
      // Bring in categories the current store does not have yet.
      var names = {};
      state.categories.forEach(function (c) { names[c.name.toLowerCase()] = true; });
      var expIdMap = {};
      incoming.categories.forEach(function (c) {
        if (!names[c.name.toLowerCase()]) {
          c.id = uid('cat');
          c.order = state.categories.length;
          state.categories.push(c);
        }
      });
      void expIdMap;
      save();
      return { ok: true, added: added, replaced: false };
    }
    state.settings = incoming.settings;
    state.categories = incoming.categories;
    state.expenses = incoming.expenses;
    state.tombstones = incoming.tombstones || { expenses: {}, categories: {} };
    save();
    return { ok: true, added: incomingCount, replaced: true };
  }

  /* ── cross-device merge (used by sync) ─────────────────────── */

  function tsOf(record) {
    if (!record) return '';
    return String(record.updatedAt || record.createdAt || '');
  }

  /** Drop delete markers old enough that no device could still hold them. */
  function pruneTombstones(tombstones, days) {
    var cutoff = Date.now() - (days || 180) * 86400000;
    var out = { expenses: {}, categories: {} };
    ['expenses', 'categories'].forEach(function (kind) {
      var src = (tombstones && tombstones[kind]) || {};
      Object.keys(src).forEach(function (id) {
        var t = Date.parse(src[id]);
        if (!isFinite(t) || t > cutoff) out[kind][id] = src[id];
      });
    });
    return out;
  }

  /**
   * Resolve one record id across local, remote and its delete marker.
   * Latest timestamp wins. A delete marker beats an older copy, but a copy
   * edited *after* the delete is resurrected (keeps data rather than lose it).
   */
  function resolveRecord(localRec, remoteRec, deletedAt) {
    var lTs = tsOf(localRec);
    var rTs = tsOf(remoteRec);
    var alive = null;

    if (localRec && remoteRec) alive = lTs >= rTs ? localRec : remoteRec;
    else if (localRec) alive = localRec;
    else if (remoteRec) alive = remoteRec;

    if (!alive) return { record: null, tombstone: deletedAt || null };

    if (deletedAt && String(deletedAt) > tsOf(alive)) {
      // Deleted after the last edit: stays deleted.
      return { record: null, tombstone: String(deletedAt) };
    }
    return { record: alive, tombstone: null };
  }

  /**
   * Merge a remote snapshot into the local store (timestamp-based, per record).
   * Returns counts plus the merged payload so the caller can write it back.
   */
  function mergeRemote(remote) {
    load();
    if (!remote || typeof remote !== 'object') return { changed: false, expenses: state.expenses.length };

    var localTombs = state.tombstones || { expenses: {}, categories: {} };
    var remoteTombs = (remote.tombstones && typeof remote.tombstones === 'object') ? remote.tombstones : {};

    var merged = { expenses: [], categories: [] };
    var newTombs = { expenses: {}, categories: {} };
    var changed = false;

    ['expenses', 'categories'].forEach(function (kind) {
      var localList = kind === 'expenses' ? state.expenses : state.categories;
      var remoteList = Array.isArray(remote[kind]) ? remote[kind] : [];

      var localMap = {};
      localList.forEach(function (r) { if (r && r.id) localMap[r.id] = r; });
      var remoteMap = {};
      remoteList.forEach(function (r) { if (r && r.id) remoteMap[r.id] = r; });

      var ids = {};
      Object.keys(localMap).forEach(function (id) { ids[id] = true; });
      Object.keys(remoteMap).forEach(function (id) { ids[id] = true; });
      Object.keys(localTombs[kind] || {}).forEach(function (id) { ids[id] = true; });
      Object.keys(remoteTombs[kind] || {}).forEach(function (id) { ids[id] = true; });

      Object.keys(ids).forEach(function (id) {
        var lTomb = (localTombs[kind] || {})[id] || null;
        var rTomb = (remoteTombs[kind] || {})[id] || null;
        // Keep the most recent delete marker for this id.
        var tomb = lTomb && rTomb ? (String(lTomb) > String(rTomb) ? lTomb : rTomb) : (lTomb || rTomb);

        var res = resolveRecord(localMap[id], remoteMap[id], tomb);
        if (res.record) {
          merged[kind].push(res.record);
          // If a record survived a delete (edited afterwards), drop the marker.
          if (!Object.prototype.hasOwnProperty.call(localMap, id) ||
              tsOf(localMap[id]) !== tsOf(res.record)) changed = true;
        } else if (res.tombstone) {
          newTombs[kind][id] = res.tombstone;
        }
      });

      if (merged[kind].length !== (kind === 'expenses' ? state.expenses.length : state.categories.length)) changed = true;
    });

    // Categories must still exist for every expense; fall back safely.
    var catIds = {};
    merged.categories.forEach(function (c) { catIds[c.id] = true; });
    if (!merged.categories.length) {
      merged.categories = defaultCategories();
      merged.categories.forEach(function (c) { catIds[c.id] = true; });
    }
    var fallback = merged.categories[0].id;
    merged.expenses.forEach(function (e) {
      if (!catIds[e.categoryId]) { e.categoryId = fallback; changed = true; }
    });

    merged.categories.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    merged.categories.forEach(function (c, i) { c.order = i; });

    // Settings: newest snapshot wins as a whole block.
    var localStamp = String(state.updatedAt || '');
    var remoteStamp = String(remote.updatedAt || '');
    var settings = remoteStamp > localStamp && remote.settings ? remote.settings : state.settings;
    if (settings !== state.settings) changed = true;

    state.expenses = merged.expenses;
    state.categories = merged.categories;
    state.settings = Object.assign({}, defaultState().settings, settings);
    state.tombstones = pruneTombstones(newTombs);
    if (changed) withSilence(function () { save(); });

    return {
      changed: changed,
      expenses: state.expenses.length,
      categories: state.categories.length,
      payload: payload()
    };
  }

  /** The exact object stored in the cloud / written back after a merge. */
  function payload() {
    load();
    return {
      expenses: state.expenses,
      categories: state.categories,
      settings: state.settings,
      tombstones: state.tombstones || { expenses: {}, categories: {} },
      updatedAt: state.updatedAt
    };
  }

  /** Replace local content with a remote snapshot (first-time adopt). */
  function adoptRemote(remote) {
    load();
    var incoming = normalise({
      settings: remote.settings,
      categories: remote.categories,
      expenses: remote.expenses,
      tombstones: remote.tombstones,
      updatedAt: remote.updatedAt
    });
    state.settings = incoming.settings;
    state.categories = incoming.categories;
    state.expenses = incoming.expenses;
    state.tombstones = incoming.tombstones;
    state.updatedAt = remote.updatedAt || new Date().toISOString();
    withSilence(function () { save(); });
    return { expenses: state.expenses.length };
  }

  function resetAll() {
    state = defaultState();
    save();
    return state;
  }

  function stats() {
    load();
    return {
      expenses: state.expenses.length,
      categories: state.categories.length,
      plans: state.expenses.filter(function (e) { return e.months >= 2; }).length,
      storage: memoryOnly ? 'memory' : 'local'
    };
  }

  global.BudgetStore = {
    KEY: STORE_KEY,
    PALETTE: PALETTE,
    // dates & formatting
    todayStr: todayStr, toDateStr: toDateStr, monthOf: monthOf, currentMonth: currentMonth,
    addMonths: addMonths, monthIndex: monthIndex, monthName: monthName, shortMonthName: shortMonthName,
    formatDate: formatDate, parseAmount: parseAmount, round2: round2, uid: uid,
    // state
    get: get, save: save, settings: settings, updateSettings: updateSettings, stats: stats,
    // categories
    categories: categories, categoryById: categoryById, addCategory: addCategory,
    updateCategory: updateCategory, deleteCategory: deleteCategory, moveCategory: moveCategory,
    // expenses
    expensesSorted: expensesSorted, expenseById: expenseById, addExpense: addExpense,
    updateExpense: updateExpense, deleteExpense: deleteExpense,
    // installments & reports
    splitAmount: splitAmount, chargedInMonth: chargedInMonth, planStatus: planStatus,
    activeMonths: activeMonths, monthTotal: monthTotal, monthSummary: monthSummary,
    monthlySeries: monthlySeries, categoryBreakdown: categoryBreakdown, noteBreakdown: noteBreakdown,
    plans: plans, plansActiveSummary: plansActiveSummary,
    // backup
    exportJSON: exportJSON, importJSON: importJSON, resetAll: resetAll,
    // cross-device sync support
    payload: payload, mergeRemote: mergeRemote, adoptRemote: adoptRemote, pruneTombstones: pruneTombstones,
    // change notification for sync
    onChange: onChange
  };
})(window);

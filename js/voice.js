/* Budget — push-to-talk expense entry.
 *
 * Two clearly separated parts:
 *   1. parse(transcript, categories)  — PURE function. No DOM, no mic, no
 *      browser APIs. Turns "spent forty five on groceries yesterday" into a
 *      structured expense draft. Kept pure so it can be tested exhaustively.
 *   2. The microphone wrapper around the Web Speech API (Chrome / Edge /
 *      Android Chrome). Audio transcription is done by the browser vendor's
 *      service, so it needs an internet connection.
 *
 * IMPORTANT: this module never saves anything. It only produces a draft that
 * the caller places into the existing form for the user to confirm.
 */
(function (global) {
  'use strict';

  /* ── number words ──────────────────────────────────────────── */

  var UNITS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19
  };

  var TENS = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90
  };

  var SCALES = { hundred: 100, thousand: 1000, million: 1000000, k: 1000 };

  var ORDINALS = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
    fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
    eighteenth: 18, nineteenth: 19, twentieth: 20, 'twenty-first': 21,
    'twenty-second': 22, 'twenty-third': 23, 'twenty-fourth': 24,
    'twenty-fifth': 25, 'twenty-sixth': 26, 'twenty-seventh': 27,
    'twenty-eighth': 28, 'twenty-ninth': 29, thirtieth: 30, 'thirty-first': 31
  };

  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  function isNumberWord(w) {
    return Object.prototype.hasOwnProperty.call(UNITS, w) ||
           Object.prototype.hasOwnProperty.call(TENS, w) ||
           Object.prototype.hasOwnProperty.call(SCALES, w);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function dateToStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayStr() { return dateToStr(new Date()); }

  /**
   * Convert a run of number words to a value.
   * Handles "twelve hundred" (1200), "two thousand five hundred" (2500),
   * "a hundred" (100) and the money shorthand "three fifty" (3.50).
   */
  function wordsToNumber(words) {
    if (!words.length) return null;

    // Money shorthand: <1..99> + <tens>  e.g. "three fifty" -> 3.50,
    // "twelve fifty" -> 12.50. Only when there are exactly two words and no
    // scale word, otherwise it is a normal number.
    if (words.length === 2 &&
        !SCALES[words[0]] && !SCALES[words[1]] &&
        (UNITS[words[0]] != null || words[0] === 'a') &&
        TENS[words[1]] != null) {
      var whole = (words[0] === 'a') ? 1 : UNITS[words[0]];
      return Math.round((whole + TENS[words[1]] / 100) * 100) / 100;
    }

    var total = 0;
    var current = 0;
    var seenAny = false;

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w === 'and') continue;
      if (w === 'a' || w === 'an') { current += 1; seenAny = true; continue; }
      if (UNITS[w] != null) { current += UNITS[w]; seenAny = true; continue; }
      if (TENS[w] != null) { current += TENS[w]; seenAny = true; continue; }
      if (w === 'hundred') { current = (current || 1) * 100; seenAny = true; continue; }
      if (w === 'thousand' || w === 'k') { total += (current || 1) * 1000; current = 0; seenAny = true; continue; }
      if (w === 'million') { total += (current || 1) * 1000000; current = 0; seenAny = true; continue; }
    }

    if (!seenAny) return null;
    return total + current;
  }

  /* ── tokenising ────────────────────────────────────────────── */

  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/(\d),(?=\d{3}\b)/g, '$1')       // 1,200 -> 1200
      .replace(/[^\w\s.:'-]/g, ' ')             // drop currency symbols etc.
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map(function (w, i) { return { w: w, i: i, used: false }; });
  }

  /** Find the first number made of digits, e.g. "45", "45.50", "1.2k". */
  function findDigitNumber(tokens, usedFlags) {
    for (var i = 0; i < tokens.length; i++) {
      if (usedFlags[i]) continue;
      var w = tokens[i].w;
      var m = w.match(/^(\d+(?:\.\d+)?)(k)?$/);
      if (m) {
        var val = parseFloat(m[1]);
        if (m[2]) val *= 1000;
        if (!isFinite(val)) continue;
        return { value: val, start: i, end: i };
      }
    }
    return null;
  }

  /** Find the first run of number words, e.g. "forty five". */
  function findWordNumber(tokens, usedFlags) {
    for (var i = 0; i < tokens.length; i++) {
      if (usedFlags[i]) continue;
      if (tokens[i].w === 'a' || tokens[i].w === 'an') {
        // Only treat "a" as 1 when a scale word follows ("a hundred").
        var nxt = tokens[i + 1];
        if (nxt && SCALES[nxt.w]) {
          var wordsA = [];
          var jA = i;
          while (jA < tokens.length && !usedFlags[jA] &&
                 (isNumberWord(tokens[jA].w) || tokens[jA].w === 'a' || tokens[jA].w === 'and')) {
            wordsA.push(tokens[jA].w);
            jA++;
          }
          var valA = wordsToNumber(wordsA);
          if (valA != null) return { value: valA, start: i, end: jA - 1 };
        }
        continue;
      }
      if (!isNumberWord(tokens[i].w)) continue;

      var words = [];
      var j = i;
      while (j < tokens.length && !usedFlags[j] &&
             (isNumberWord(tokens[j].w) || tokens[j].w === 'and')) {
        words.push(tokens[j].w);
        j++;
      }
      var val = wordsToNumber(words);
      if (val != null) return { value: val, start: i, end: j - 1 };
      i = j - 1;
    }
    return null;
  }

  /* ── feature extractors ────────────────────────────────────── */

  var CURRENCY_WORDS = ['dollars', 'dollar', 'bucks', 'buck', 'euros', 'euro',
    'pounds', 'pound', 'rupees', 'rupee', 'riyals', 'riyal', 'dirhams',
    'dirham', 'taka', 'taka\'s', 'shillings', 'naira', 'rand', 'pesos',
    'ringgit', 'francs', 'franc', 'yen', 'won', 'yuan', 'cents', 'cent'];

  /** Installments: "over 6 months", "for three months", "in 4 installments". */
  function findInstallments(tokens, usedFlags) {
    var markers = ['month', 'months', 'installment', 'installments', 'instalment', 'instalments'];
    for (var i = 0; i < tokens.length; i++) {
      if (markers.indexOf(tokens[i].w) === -1) continue;

      // Look backwards for a number, skipping the preposition.
      for (var b = i - 1; b >= 0 && b >= i - 3; b--) {
        if (usedFlags[b]) continue;
        var w = tokens[b].w;
        var val = null;

        var dm = w.match(/^(\d+)$/);
        if (dm) val = parseInt(dm[1], 10);
        else if (UNITS[w] != null) val = UNITS[w];
        else if (TENS[w] != null) val = TENS[w];

        if (val != null) {
          for (var k = b; k <= i; k++) usedFlags[k] = true;
          return { value: val, start: b, end: i };
        }
      }
    }
    return null;
  }

  var MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];

  /**
   * Dates: "today", "yesterday", "last friday", "on the 5th", "monday",
   * "november 5". Returns YYYY-MM-DD, or null when nothing is stated.
   */
  function findDate(tokens, usedFlags, now) {
    now = now || new Date();

    // Multi-word phrases must be checked BEFORE the single words, otherwise
    // "day before yesterday" matches the "yesterday" branch and lands a day off.
    for (var j = 0; j < tokens.length - 2; j++) {
      if (tokens[j].w === 'day' && tokens[j + 1].w === 'before' && tokens[j + 2].w === 'yesterday') {
        usedFlags[j] = usedFlags[j + 1] = usedFlags[j + 2] = true;
        var d2 = new Date(now.getTime());
        d2.setDate(d2.getDate() - 2);
        return dateToStr(d2);
      }
    }

    for (var i = 0; i < tokens.length; i++) {
      if (usedFlags[i]) continue;
      var w = tokens[i].w;

      if (w === 'today' || w === 'tonight') {
        usedFlags[i] = true;
        return dateToStr(now);
      }
      if (w === 'yesterday') {
        usedFlags[i] = true;
        var y = new Date(now.getTime());
        y.setDate(y.getDate() - 1);
        return dateToStr(y);
      }
      if (w === 'tomorrow') {
        usedFlags[i] = true;
        var t = new Date(now.getTime());
        t.setDate(t.getDate() + 1);
        return dateToStr(t);
      }
    }

    // Weekday -> most recent occurrence (today counts).
    for (var k = 0; k < tokens.length; k++) {
      if (usedFlags[k]) continue;
      var idx = WEEKDAYS.indexOf(tokens[k].w);
      if (idx === -1) continue;
      usedFlags[k] = true;
      if (tokens[k - 1] && tokens[k - 1].w === 'last') usedFlags[k - 1] = true;
      if (tokens[k - 1] && tokens[k - 1].w === 'on') usedFlags[k - 1] = true;

      var dd = new Date(now.getTime());
      var diff = (dd.getDay() - idx + 7) % 7;
      dd.setDate(dd.getDate() - diff);
      return dateToStr(dd);
    }

    // Month name with an optional day: "november 5" / "5 november".
    for (var m = 0; m < tokens.length; m++) {
      var mi = MONTH_NAMES.indexOf(tokens[m].w);
      if (mi === -1) continue;

      var dayVal = null;
      var dayTok = -1;
      if (tokens[m + 1] && /^\d{1,2}$/.test(tokens[m + 1].w)) { dayVal = parseInt(tokens[m + 1].w, 10); dayTok = m + 1; }
      else if (tokens[m - 1] && /^\d{1,2}$/.test(tokens[m - 1].w)) { dayVal = parseInt(tokens[m - 1].w, 10); dayTok = m - 1; }

      var yy = now.getFullYear();
      if (mi > now.getMonth()) yy -= 1;              // "november" said in january = last year
      var dt = new Date(yy, mi, dayVal || 1);
      usedFlags[m] = true;
      if (dayTok >= 0) usedFlags[dayTok] = true;
      return dateToStr(dt);
    }

    // Ordinal day of month: "on the 5th", "the fifth".
    for (var q = 0; q < tokens.length; q++) {
      if (usedFlags[q]) continue;
      var ow = tokens[q].w;
      var ordDay = null;

      var om = ow.match(/^(\d{1,2})(?:st|nd|rd|th)$/);
      if (om) ordDay = parseInt(om[1], 10);
      else if (ORDINALS[ow] != null) ordDay = ORDINALS[ow];

      if (ordDay == null || ordDay < 1 || ordDay > 31) continue;

      usedFlags[q] = true;
      if (tokens[q - 1] && tokens[q - 1].w === 'the') usedFlags[q - 1] = true;
      if (tokens[q - 2] && tokens[q - 2].w === 'on') usedFlags[q - 2] = true;

      // If that day has not happened yet this month, assume last month.
      var cand = new Date(now.getFullYear(), now.getMonth(), ordDay);
      if (cand.getDate() !== ordDay) cand = new Date(now.getFullYear(), now.getMonth() + 1, 0); // clamp
      if (cand > now) cand = new Date(now.getFullYear(), now.getMonth() - 1, ordDay);
      return dateToStr(cand);
    }

    return null;
  }

  var METHOD_WORDS = {
    cash: 'cash', cache: 'cash',
    card: 'credit', credit: 'credit', creditcard: 'credit',
    debit: 'debit', visa: 'credit', mastercard: 'credit'
  };

  function findMethod(tokens, usedFlags) {
    for (var i = 0; i < tokens.length; i++) {
      if (usedFlags[i]) continue;
      var w = tokens[i].w;
      if (METHOD_WORDS[w]) {
        usedFlags[i] = true;
        if (tokens[i + 1] && tokens[i + 1].w === 'card') {
          usedFlags[i + 1] = true;
          return w === 'debit' ? 'debit' : 'credit';
        }
        return METHOD_WORDS[w];
      }
    }
    return null;
  }

  /* ── categories ────────────────────────────────────────────── */

  var CATEGORY_SYNONYMS = {
    household: ['groceries', 'grocery', 'supermarket', 'supermarkets', 'shop',
      'shopping', 'market', 'grocer', 'vegetables', 'fruit', 'household',
      'home', 'house', 'furniture', 'kitchen', 'cleaning', 'utilities',
      'utility', 'electricity', 'electric', 'water', 'soap', 'detergent'],
    compulsory: ['bill', 'bills', 'insurance', 'rent', 'school', 'tuition',
      'fee', 'fees', 'tax', 'taxes', 'loan', 'loans', 'emi', 'installment',
      'compulsory', 'mandatory', 'maintenance', 'subscription'],
    entertainment: ['cinema', 'movie', 'movies', 'netflix', 'spotify',
      'streaming', 'game', 'games', 'gaming', 'concert', 'outing', 'fun',
      'entertainment', 'party', 'tickets'],
    food: ['food', 'restaurant', 'lunch', 'dinner', 'breakfast', 'coffee',
      'cafe', 'snack', 'snacks', 'takeaway', 'delivery', 'pizza', 'burger',
      'eat', 'eating', 'meal', 'tea', 'juice'],
    transport: ['fuel', 'petrol', 'diesel', 'gas', 'bus', 'taxi', 'uber',
      'careem', 'train', 'metro', 'parking', 'car', 'bike', 'transport',
      'transportation', 'toll', 'oil'],
    health: ['doctor', 'pharmacy', 'medicine', 'medicines', 'hospital',
      'dentist', 'gym', 'medical', 'clinic', 'health', 'tablets'],
    other: ['gift', 'gifts', 'donation', 'charity', 'clothes', 'clothing',
      'shoes', 'other', 'misc']
  };

  /**
   * Match a category from the transcript. Real category names win over the
   * built-in synonym list, so renamed or custom categories still work.
   */
  function findCategory(tokens, usedFlags, categories) {
    var cats = categories || [];

    // Longest name first, so "School fees" beats "School".
    var named = cats.slice().sort(function (a, b) {
      return String(b.name).length - String(a.name).length;
    });

    for (var c = 0; c < named.length; c++) {
      var words = String(named[c].name).toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i <= tokens.length - words.length; i++) {
        var hit = true;
        for (var k = 0; k < words.length; k++) {
          if (usedFlags[i + k] || tokens[i + k].w !== words[k]) { hit = false; break; }
        }
        if (hit) {
          for (var m = 0; m < words.length; m++) usedFlags[i + m] = true;
          return { id: named[c].id, exactName: true, word: words.join(' ') };
        }
      }
    }

    for (var i2 = 0; i2 < tokens.length; i2++) {
      if (usedFlags[i2]) continue;
      var w = tokens[i2].w;
      for (var key in CATEGORY_SYNONYMS) {
        if (!Object.prototype.hasOwnProperty.call(CATEGORY_SYNONYMS, key)) continue;
        if (CATEGORY_SYNONYMS[key].indexOf(w) === -1) continue;
        // Only map if that category still exists (user may have deleted it).
        var found = null;
        for (var s = 0; s < cats.length; s++) if (cats[s].id === key) { found = cats[s]; break; }
        if (!found) continue;
        // Deliberately NOT marked as used: a synonym is a description of what
        // was bought ("groceries", "cinema"), so it belongs in the note. Only
        // an exact category name is dropped, because that would just repeat
        // the category chip.
        return { id: found.id, exactName: false, word: w };
      }
    }

    return null;
  }

  /* ── noise words ───────────────────────────────────────────── */

  var FILLERS = ['i', 'spent', 'spend', 'pay', 'paid', 'bought', 'buy',
    'purchased', 'add', 'adds', 'record', 'log', 'logged', 'expense',
    'expenses', 'for', 'on', 'at', 'in', 'the', 'a', 'an', 'of', 'to', 'my',
    'was', 'it', 'is', 'and', 'about', 'around', 'roughly', 'approximately',
    'like', 'please', 'total', 'cost', 'costs', 'that', 'this', 'with',
    'using', 'via', 'over', 'per', 'each', 'just', 'only', 'some'];

  /* ── the parser ────────────────────────────────────────────── */

  /**
   * Turn a spoken transcript into an expense draft.
   *
   * @param {string} transcript   what the mic heard
   * @param {Array}  categories   [{id, name, ...}] from the store
   * @param {Object} [opts]       { now: Date }
   * @returns {Object} draft: { amount, categoryId, date, method, months, note,
   *                            heard, warnings[], confidence }
   */
  function parse(transcript, categories, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var text = String(transcript || '').trim();

    var tokens = tokenize(text);
    var used = new Array(tokens.length).fill(false);
    var warnings = [];

    if (!tokens.length) {
      return {
        amount: null, categoryId: null, date: null, method: null, months: 0,
        note: '', warnings: ['Nothing was heard.'], confidence: 'none', heard: ''
      };
    }

    /* 1. installments first — "6 months" must not be read as the amount */
    var inst = findInstallments(tokens, used);
    var months = 0;
    if (inst) {
      if (inst.value >= 2 && inst.value <= 60) months = inst.value;
      else warnings.push('Installment count ' + inst.value + ' is out of range (2–60), ignored.');
    }

    /* 2. date — "on the 5th" must not be read as the amount */
    var date = findDate(tokens, used, now);

    /* 3. method */
    var method = findMethod(tokens, used);

    /* 4. amount — prefer a number next to a currency word */
    var amount = null;
    var moneyIndex = -1;
    for (var ci = 0; ci < tokens.length; ci++) {
      if (CURRENCY_WORDS.indexOf(tokens[ci].w) !== -1) { moneyIndex = ci; break; }
    }

    function tryNear(idx) {
      if (idx < 0) return null;
      // Look left then right within 2 tokens.
      for (var off = 1; off <= 2; off++) {
        var left = idx - off;
        if (left >= 0 && !used[left]) {
          var dm = tokens[left].w.match(/^(\d+(?:\.\d+)?)(k)?$/);
          if (dm) {
            used[left] = true;
            return parseFloat(dm[1]) * (dm[2] ? 1000 : 1);
          }
          if (isNumberWord(tokens[left].w)) {
            var startL = left;
            while (startL - 1 >= 0 && !used[startL - 1] && (isNumberWord(tokens[startL - 1].w) || tokens[startL - 1].w === 'and')) startL--;
            var wordsL = [];
            for (var a = startL; a <= left; a++) wordsL.push(tokens[a].w);
            var vL = wordsToNumber(wordsL);
            if (vL != null) { for (var b = startL; b <= left; b++) used[b] = true; return vL; }
          }
        }
        var right = idx + off;
        if (right < tokens.length && !used[right]) {
          var dmr = tokens[right].w.match(/^(\d+(?:\.\d+)?)(k)?$/);
          if (dmr) {
            used[right] = true;
            return parseFloat(dmr[1]) * (dmr[2] ? 1000 : 1);
          }
          if (isNumberWord(tokens[right].w)) {
            var endR = right;
            while (endR + 1 < tokens.length && !used[endR + 1] && (isNumberWord(tokens[endR + 1].w) || tokens[endR + 1].w === 'and')) endR++;
            var wordsR = [];
            for (var c2 = right; c2 <= endR; c2++) wordsR.push(tokens[c2].w);
            var vR = wordsToNumber(wordsR);
            if (vR != null) { while (right <= endR) { used[right] = true; right++; } return vR; }
          }
        }
      }
      return null;
    }

    if (moneyIndex >= 0) amount = tryNear(moneyIndex);

    if (amount == null) {
      var d = findDigitNumber(tokens, used);
      if (d) { amount = d.value; for (var x = d.start; x <= d.end; x++) used[x] = true; }
    }
    if (amount == null) {
      var wn = findWordNumber(tokens, used);
      if (wn) { amount = wn.value; for (var y = wn.start; y <= wn.end; y++) used[y] = true; }
    }
    if (amount != null && (!isFinite(amount) || amount <= 0)) {
      warnings.push('The amount did not look like a positive number.');
      amount = null;
    }
    if (amount == null) warnings.push('No amount heard — type it in.');

    /* 5. category */
    var cat = findCategory(tokens, used, categories);
    var categoryId = cat ? cat.id : null;
    if (!cat) warnings.push('No category matched — pick one.');

    /* 6. note = remaining meaningful words */
    var noteWords = [];
    for (var z = 0; z < tokens.length; z++) {
      if (used[z]) continue;
      var w2 = tokens[z].w;
      if (FILLERS.indexOf(w2) !== -1) continue;
      if (CURRENCY_WORDS.indexOf(w2) !== -1) continue;
      if (/^\d+$/.test(w2)) continue;
      if (/^(\d+)(st|nd|rd|th)$/.test(w2)) continue;
      noteWords.push(w2);
    }
    var note = noteWords.join(' ').trim().slice(0, 80);

    /* 7. installments imply a card payment */
    if (months >= 2 && !method) method = 'credit';

    var confidence = 'low';
    if (amount != null && categoryId) confidence = warnings.length ? 'medium' : 'high';

    return {
      amount: amount,
      categoryId: categoryId,
      date: date || todayStr(),
      dateStated: !!date,
      method: method || 'cash',
      months: months,
      note: note,
      warnings: warnings,
      confidence: confidence,
      heard: text
    };
  }

  /* ── microphone wrapper ────────────────────────────────────── */

  var recognition = null;
  var listening = false;
  var handlers = {};

  function RecognitionCtor() {
    return global.SpeechRecognition || global.webkitSpeechRecognition || null;
  }

  function isSupported() { return !!RecognitionCtor(); }

  /** HTTPS or localhost is required by the browser, not by this code. */
  function isSecureContextOk() {
    return global.isSecureContext !== false &&
      (global.location.protocol === 'https:' ||
       global.location.hostname === 'localhost' ||
       global.location.hostname === '127.0.0.1');
  }

  var ERROR_MESSAGES = {
    'not-allowed': 'Microphone access is blocked. Allow the mic in your browser settings and try again.',
    'service-not-allowed': 'The browser blocked speech recognition. Allow the mic and try again.',
    'no-speech': 'I did not hear anything. Try again a little closer to the mic.',
    'audio-capture': 'No microphone was found on this device.',
    'network': 'Speech recognition needs an internet connection to transcribe.',
    'aborted': 'Listening stopped.',
    'language-not-supported': 'Your browser does not support this language for speech.'
  };

  function friendlyError(code) {
    return ERROR_MESSAGES[code] || ('Speech recognition failed (' + code + ').');
  }

  /**
   * Start listening. Callbacks:
   *   onInterim(text)  live partial transcript
   *   onResult(text)   final transcript
   *   onError(message) human-readable failure
   *   onEnd()          always fires when listening stops
   */
  function start(callbacks) {
    handlers = callbacks || {};
    var Ctor = RecognitionCtor();

    if (!Ctor) {
      if (handlers.onError) handlers.onError('Voice input is not supported in this browser. Chrome, Edge or Android Chrome works best.');
      return false;
    }
    if (!isSecureContextOk()) {
      if (handlers.onError) handlers.onError('Voice input needs an https:// address (or localhost).');
      return false;
    }
    if (listening) return true;

    try {
      recognition = new Ctor();
    } catch (e) {
      if (handlers.onError) handlers.onError('Could not start the microphone.');
      return false;
    }

    recognition.lang = (global.navigator && global.navigator.language) || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      listening = true;
      if (handlers.onStart) handlers.onStart();
    };

    recognition.onresult = function (event) {
      var interim = '';
      var finalText = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim && handlers.onInterim) handlers.onInterim(interim.trim());
      if (finalText && handlers.onResult) handlers.onResult(finalText.trim());
    };

    recognition.onerror = function (event) {
      listening = false;
      if (handlers.onError) handlers.onError(friendlyError(event.error));
    };

    recognition.onend = function () {
      listening = false;
      if (handlers.onEnd) handlers.onEnd();
    };

    try {
      recognition.start();
      return true;
    } catch (e) {
      listening = false;
      if (handlers.onError) handlers.onError('Could not start listening.');
      return false;
    }
  }

  function stop() {
    if (recognition && listening) {
      try { recognition.stop(); } catch (e) { /* already stopping */ }
    }
  }

  function isListening() { return listening; }

  global.BudgetVoice = {
    parse: parse,
    start: start,
    stop: stop,
    isListening: isListening,
    isSupported: isSupported,
    // exported for testing / reuse
    wordsToNumber: wordsToNumber,
    _tokenize: tokenize
  };
})(window);

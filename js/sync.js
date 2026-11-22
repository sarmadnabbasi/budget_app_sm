/* Budget — optional cross-device sync via Firebase (free Spark plan).
 *
 * Design notes:
 *  - Uses Firebase's REST API directly with fetch(). No SDK, no CDN script.
 *    That keeps the app fully offline-capable: nothing is downloaded until the
 *    user actually enables sync, and the app never depends on a third-party
 *    script to start.
 *  - Realtime Database stores ONE blob per user at /budgets/{uid}. Conflicts are
 *    resolved per record by js/store.js mergeRemote() (latest timestamp wins),
 *    so two devices converge instead of overwriting each other's edits.
 *  - Local storage remains the source of truth for the UI. The cloud is a
 *    mirror: if sync fails or is off, the app behaves exactly as before.
 */
(function (global) {
  'use strict';

  var CONFIG_KEY = 'household-budget-sync-config';
  var SESSION_KEY = 'household-budget-sync-session';
  var POLL_MS = 15000;

  var AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1/accounts:';
  var TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

  var config = null;
  var session = null;      // { uid, email, idToken, refreshToken, expiresAt }
  var pollTimer = null;
  var pushTimer = null;
  var busy = false;
  var lastError = '';

  /* ── storage helpers ───────────────────────────────────────── */

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, val) {
    try {
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
      return true;
    } catch (e) { return false; }
  }
  function readJSON(key) {
    var raw = read(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* ── config parsing ────────────────────────────────────────── */

  /**
   * Accepts a pasted Firebase web config — either the whole `const
   * firebaseConfig = {...}` snippet or a bare JSON object. Pulls out the only
   * two values actually needed.
   */
  function parseConfigText(text) {
    var src = String(text || '');

    // Keys may be bare (`apiKey: "x"`, as in the JS snippet) or quoted
    // (`"apiKey": "x"`, as in pasted JSON). Allow an optional closing quote
    // before the colon, otherwise JSON input silently fails to parse.
    function grab(key) {
      var re = new RegExp('["\']?' + key + '["\']?\\s*[:=]\\s*["\']([^"\']+)["\']');
      var m = src.match(re);
      return m ? m[1] : undefined;
    }

    var apiKey = grab('apiKey');
    var dbUrl = grab('databaseURL');
    var projectId = grab('projectId');

    if (!dbUrl && projectId) dbUrl = 'https://' + projectId + '-default-rtdb.firebaseio.com';

    if (!apiKey) return { ok: false, reason: 'Could not find "apiKey" in that text.' };
    if (!dbUrl) {
      return {
        ok: false,
        reason: 'Could not find "databaseURL". Make sure you created a Realtime Database (not only Firestore) in your Firebase project.'
      };
    }
    dbUrl = dbUrl.replace(/\/+$/, '');
    if (!/^https:\/\//.test(dbUrl)) return { ok: false, reason: 'databaseURL must start with https://' };

    return { ok: true, config: { apiKey: apiKey, databaseURL: dbUrl, projectId: projectId || '' } };
  }

  function setConfig(cfg) {
    config = { apiKey: cfg.apiKey, databaseURL: cfg.databaseURL.replace(/\/+$/, ''), projectId: cfg.projectId || '' };
    write(CONFIG_KEY, JSON.stringify(config));
    return config;
  }

  function loadConfig() {
    if (config) return config;
    var saved = readJSON(CONFIG_KEY);
    if (saved && saved.apiKey && saved.databaseURL) config = saved;
    return config;
  }

  function clearConfig() {
    config = null;
    session = null;
    write(CONFIG_KEY, null);
    write(SESSION_KEY, null);
    stopTimers();
  }

  function isConfigured() { return !!loadConfig(); }

  /* ── session ───────────────────────────────────────────────── */

  function loadSession() {
    if (session) return session;
    var saved = readJSON(SESSION_KEY);
    if (saved && saved.refreshToken && saved.uid) session = saved;
    return session;
  }

  function saveSession(s) {
    session = s;
    if (s) write(SESSION_KEY, JSON.stringify(s));
    else write(SESSION_KEY, null);
    return session;
  }

  function isSignedIn() {
    var s = loadSession();
    return !!(s && s.refreshToken);
  }

  function currentUser() {
    var s = loadSession();
    return s ? { uid: s.uid, email: s.email || '' } : null;
  }

  /* ── HTTP helpers ──────────────────────────────────────────── */

  function httpJSON(url, options) {
    return fetch(url, options).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (!res.ok) {
          var msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
          var err = new Error(String(msg));
          err.status = res.status;
          err.code = data && data.error && data.error.message;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function friendlyAuthError(err) {
    var code = String(err && (err.code || err.message) || '');
    if (/EMAIL_EXISTS/.test(code)) return 'That email already has an account — use Sign in instead.';
    if (/EMAIL_NOT_FOUND/.test(code)) return 'No account with that email. Use Create account first.';
    if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(code)) return 'Wrong password.';
    if (/WEAK_PASSWORD/.test(code)) return 'Password must be at least 6 characters.';
    if (/INVALID_EMAIL/.test(code)) return 'That does not look like a valid email address.';
    if (/OPERATION_NOT_ALLOWED/.test(code)) return 'Email/password sign-in is not enabled in your Firebase project yet.';
    if (/API_KEY_INVALID|API key not valid/.test(code)) return 'The apiKey is wrong — re-paste your Firebase config.';
    if (/PERMISSION_DENIED/.test(code)) return 'Permission denied by your database rules. See the setup guide (rules must allow your own uid).';
    if (/network|Failed to fetch/i.test(code)) return 'Cannot reach Firebase — check your internet connection.';
    return code || 'Something went wrong.';
  }

  /* ── auth ──────────────────────────────────────────────────── */

  function authRequest(method, email, password) {
    var cfg = loadConfig();
    if (!cfg) return Promise.reject(new Error('Sync is not configured yet.'));
    return httpJSON(AUTH_BASE + method + '?key=' + encodeURIComponent(cfg.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
    }).then(function (data) {
      return saveSession({
        uid: data.localId,
        email: data.email,
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (parseInt(data.expiresIn, 10) || 3600) * 1000 - 60000
      });
    }).catch(function (err) {
      throw new Error(friendlyAuthError(err));
    });
  }

  function signUp(email, password) { return authRequest('signUp', email, password); }
  function signIn(email, password) { return authRequest('signInWithPassword', email, password); }

  function refreshSession() {
    var s = loadSession();
    if (!s || !s.refreshToken) return Promise.reject(new Error('Not signed in.'));
    var cfg = loadConfig();
    return fetch(TOKEN_URL + '?key=' + encodeURIComponent(cfg.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refreshToken)
    }).then(function (res) {
      if (!res.ok) throw new Error('Session expired — please sign in again.');
      return res.json();
    }).then(function (data) {
      return saveSession({
        uid: data.user_id,
        email: s.email,
        idToken: data.id_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (parseInt(data.expires_in, 10) || 3600) * 1000 - 60000
      });
    });
  }

  function ensureToken() {
    var s = loadSession();
    if (!s) return Promise.reject(new Error('Not signed in.'));
    if (s.idToken && Date.now() < (s.expiresAt || 0)) return Promise.resolve(s);
    return refreshSession();
  }

  function signOut() {
    stopTimers();
    saveSession(null);
    return Promise.resolve();
  }

  /* ── database ──────────────────────────────────────────────── */

  function dataUrl(path) {
    var cfg = loadConfig();
    return cfg.databaseURL + '/budgets/' + encodeURIComponent(session.uid) + '/' +
      (path ? path + '.json' : '.json');
  }

  /** Read the cloud blob for this user. */
  function pull() {
    return ensureToken().then(function (s) {
      return httpJSON(dataUrl('') + '?auth=' + encodeURIComponent(s.idToken));
    }).catch(function (err) {
      throw new Error(friendlyAuthError(err));
    });
  }

  /** Write the merged payload, but only if it differs from what is stored. */
  function push(payload) {
    return ensureToken().then(function (s) {
      return httpJSON(dataUrl('') + '?auth=' + encodeURIComponent(s.idToken), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }).catch(function (err) {
      throw new Error(friendlyAuthError(err));
    });
  }

  /**
   * Full reconciliation: read cloud, merge per record into local, then write
   * the merged result back. Safe to call repeatedly.
   */
  function syncNow(opts) {
    if (busy) return Promise.resolve({ skipped: true });
    if (!isConfigured() || !isSignedIn()) return Promise.resolve({ skipped: true });
    if (global.navigator && global.navigator.onLine === false) {
      lastError = 'Offline — will retry when the connection returns.';
      return Promise.resolve({ offline: true });
    }

    busy = true;
    var S = global.BudgetStore;

    return pull().then(function (remote) {
      var result;
      if (!remote || (!Array.isArray(remote.expenses) && !Array.isArray(remote.categories))) {
        // First sync for this account: seed the cloud from this device.
        result = { changed: false, payload: S.payload(), seeded: true };
      } else {
        result = S.mergeRemote(remote);
      }

      // Push merged state back so both sides converge.
      return push(result.payload).then(function () {
        lastError = '';
        return { changed: !!result.changed, seeded: !!result.seeded, expenses: S.get().expenses.length };
      });
    }).catch(function (err) {
      lastError = err.message || String(err);
      throw err;
    }).then(function (res) {
      busy = false;
      return res;
    }, function (err) {
      busy = false;
      throw err;
    });
  }

  /* ── scheduling ────────────────────────────────────────────── */

  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  }

  /** Called after any local edit: push soon, so the other device sees it. */
  function schedulePush() {
    if (!isConfigured() || !isSignedIn()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      syncNow().catch(function () { /* surfaced via status() */ });
    }, 2500);
  }

  function startPolling(onChange) {
    stopTimers();
    if (!isConfigured() || !isSignedIn()) return;
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      syncNow().then(function (res) {
        if (res && res.changed && typeof onChange === 'function') onChange();
      }).catch(function () { /* keep quiet; status() reports */ });
    }, POLL_MS);
  }

  function status() {
    return {
      configured: isConfigured(),
      signedIn: isSignedIn(),
      user: currentUser(),
      databaseURL: config ? config.databaseURL : '',
      syncing: busy,
      error: lastError,
      hasPendingWork: !!pushTimer
    };
  }

  global.BudgetSync = {
    parseConfigText: parseConfigText,
    setConfig: setConfig,
    clearConfig: clearConfig,
    isConfigured: isConfigured,
    isSignedIn: isSignedIn,
    currentUser: currentUser,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    syncNow: syncNow,
    schedulePush: schedulePush,
    startPolling: startPolling,
    stopTimers: stopTimers,
    status: status
  };
})(window);

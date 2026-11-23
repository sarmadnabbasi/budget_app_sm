/* Firebase config for cross-device sync.
 *
 * Paste your two values here ONCE (they are already in Settings on the device
 * where you set sync up). After committing this file, any new browser or device
 * only needs your EMAIL + PASSWORD to sign in — no config pasting again.
 *
 * ── Is it safe to commit these? ──────────────────────────────────────────────
 * YES. A Firebase *web* API key is designed to be public; it identifies your
 * project, it does not grant access. Your budget is protected by the Realtime
 * Database rules, which only allow a signed-in user to read/write their own
 * uid. Anyone with this key still cannot read your data without your password.
 * (This is why the rules step in HOSTING.md is the part that actually matters.)
 *
 * ── Where to find the values ─────────────────────────────────────────────────
 *   apiKey       Firebase console → Project settings (gear) → General
 *                → "Web API Key"  (starts with AIza...)
 *   databaseURL  Firebase console → Build → Realtime Database
 *                → the URL shown at the top of that page
 *                (often https://<project>-default-rtdb.firebaseio.com,
 *                 newer projects may end in .firebasedatabase.app)
 *
 * Copy the database URL EXACTLY as shown — do not retype it from memory.
 *
 * Leave both empty if you do not want sync; the app then runs local-only and
 * asks for the config in Settings as before.
 */
window.BUDGET_FIREBASE_CONFIG = {
  apiKey: "",
  databaseURL: "",
  projectId: ""
};

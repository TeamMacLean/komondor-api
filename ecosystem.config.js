/**
 * PM2 process definition for komondor-api.
 *
 * This codifies how the production process on martin is already running
 * (verified against `pm2 describe komondor-api`: fork mode, single instance,
 * interpreter node, no script args) and pins the two settings that the file
 * transfer safety net depends on. Adopting it should not change behaviour.
 *
 *   pm2 delete komondor-api
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *
 * `pm2 save` matters: without it PM2 keeps the old saved process list and
 * would resurrect the previous definition on a server reboot.
 *
 * Note that none of this makes a shutdown mid-transfer safe on its own. That
 * comes from File.moveToFolderAndSave writing to a `.part-` sibling and
 * renaming it into place, so a killed process can never leave a truncated
 * file under the real name.
 */

module.exports = {
  apps: [
    {
      name: "komondor-api",
      script: "server.js",

      // MUST stay at a single fork-mode process. This is what production
      // already runs; it is stated explicitly so a later `pm2 scale` or a
      // switch to cluster mode is an obvious change rather than a silent one.
      //
      // Both safety mechanisms in this app are per-process and in memory: the
      // active-transfer register that shutdown consults, and the md5JobRunning
      // flag that stops overlapping verification passes. Under cluster mode
      // each worker keeps its own copy, so one worker would exit cleanly while
      // another was mid-transfer, and every worker would run the 5-minute cron
      // against the same runs.
      instances: 1,
      exec_mode: "fork",

      // PM2 sends this, then SIGKILLs after kill_timeout. SIGKILL cannot be
      // intercepted, so the shutdown block in server.js only ever buys the
      // window below — it is a courtesy to the operator, not a guarantee.
      kill_signal: "SIGINT",

      // Long enough for the graceful path (draining connections, closing
      // Mongo) to finish unhurried; server.js gives up and exits after 10s
      // regardless. Deliberately NOT sized to cover a multi-terabyte copy:
      // that would stall every deploy for hours, and the .part-then-rename
      // write already makes an interrupted copy harmless.
      kill_timeout: 30000,

      listen_timeout: 10000,
      autorestart: true,

      // No max_memory_restart: it restarts the same way PM2 stops anything —
      // SIGINT then SIGKILL — so it would interrupt transfers unprompted, at
      // the least predictable moment.

      // No env block, deliberately. Production currently runs with NODE_ENV
      // unset (`node env: N/A`), and setting it to "production" would change
      // what the API returns: handleError in routes/_utils.js replaces the
      // message on 500s with a generic one in production mode. That may well
      // be what you want, but it is a separate decision from this file.
    },
  ],
};

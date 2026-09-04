/**
 * Server start-up hooks.
 *
 * The only thing registered here is the Daily Update cut-off timer: at the
 * configured hour (22:00 by default) anyone who has not submitted their update
 * has one filed from their GitHub commits.
 *
 * Why a timer rather than only an endpoint: this module is deployed as a plain
 * `next start` server with no platform scheduler behind it, so an in-process
 * clock is what makes 22:00 actually happen. The endpoint stays available for a
 * real cron; both take the same one-per-day slot lock in the database, so
 * running both — or running two app instances — still submits once.
 *
 * Set TM_SCHEDULER=off to disable the timer (for example on a second instance
 * where an external cron owns the schedule).
 */

const TICK_MS = 60_000;

export async function register() {
  // Only the Node.js server runtime has a database; skip Edge and the browser.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.TM_SCHEDULER === 'off') {
    console.log('[tm] daily update scheduler disabled (TM_SCHEDULER=off)');
    return;
  }

  const { getAutoConfig, localDate, runAutoDailyUpdates } = await import('./lib/autoDailyUpdate');

  // Remembers the slot this process has already handed to the runner, so a
  // minute that ticks twice does not queue two sweeps. The database slot lock
  // is what guarantees it across processes; this just avoids the round trip.
  let lastAttempt: string | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    try {
      const config = await getAutoConfig();
      if (!config.enabled) return;

      const now = new Date();
      const date = localDate(now);
      const dueMinutes = config.hour * 60 + config.minute;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      // Fire once the cut-off has passed. A server started at 23:10 still files
      // the 22:00 sweep for that day rather than skipping it silently.
      if (nowMinutes < dueMinutes) return;
      if (lastAttempt === date) return;
      lastAttempt = date;

      running = true;
      const result = await runAutoDailyUpdates({ date, trigger: 'SCHEDULER' });
      if (result.ran) {
        console.log(
          `[tm] auto daily update ${date}: ${result.submitted} submitted, ${result.skipped} skipped, ` +
            `${result.failed} failed (${result.considered} considered, ${result.duration_ms}ms)`,
        );
      }
    } catch (err) {
      console.error('[tm] daily update scheduler tick failed:', err);
      // Let the next day retry; a failed sweep must not wedge the timer.
      lastAttempt = null;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, TICK_MS);
  // Never hold the process open for the timer alone.
  timer.unref?.();

  console.log('[tm] daily update cut-off scheduler started');
}

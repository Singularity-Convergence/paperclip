/**
 * In-memory counter for routine "ghost" executions — execution issues the
 * routine engine auto-cancelled because they had remained `in_progress` for
 * more than the stale threshold (default 90 minutes) with no recent agent
 * activity. See SIN-2267.
 *
 * Counter semantics:
 * - One entry per `routineId` (the full UUID, not the short form).
 * - Increments by 1 each time the engine successfully PATCHes a stale
 *   execution issue to `cancelled`. Failures do not increment; the auto-cancel
 *   is best-effort and never blocks the new fire.
 * - The counter resets to zero on process restart. This is acceptable for v1
 *   because the health endpoint is read by the running process; a restart
 *   wipes the visible state along with the routine engine state.
 * - Counters are exposed via the `/health` endpoint under
 *   `routineGhostExecutionsTotal`. The Prometheus-style name is
 *   `paperclip_routine_ghost_executions_total{routine_id=...}`.
 */
const routineGhostExecutionCounters = new Map<string, number>();

export const ROUTINE_GHOST_EXECUTIONS_TOTAL_METRIC = "paperclip_routine_ghost_executions_total";

export function incrementRoutineGhostExecutionCounter(routineId: string): number {
  const current = routineGhostExecutionCounters.get(routineId) ?? 0;
  const next = current + 1;
  routineGhostExecutionCounters.set(routineId, next);
  return next;
}

export function getRoutineGhostExecutionCounter(routineId: string): number {
  return routineGhostExecutionCounters.get(routineId) ?? 0;
}

export function listRoutineGhostExecutionCounters(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [routineId, count] of routineGhostExecutionCounters) {
    out[routineId] = count;
  }
  return out;
}

/**
 * Test-only reset hook. The counter is a process-local singleton, so each
 * vitest worker must clear it between cases to avoid leaking counts across
 * tests in the same worker.
 */
export function __resetRoutineGhostExecutionCountersForTesting(): void {
  routineGhostExecutionCounters.clear();
}
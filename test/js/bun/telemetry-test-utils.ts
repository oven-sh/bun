/**
 * Shared test utilities for Bun.telemetry tests
 */

/**
 * Wait for expected telemetry events with polling instead of fixed sleep.
 * This avoids timing-dependent test flakes in CI.
 *
 * @param events - Array of telemetry events to poll
 * @param expectedTypes - Array of event types to wait for (e.g., ["start", "end"])
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 500ms)
 * @throws Error if timeout is reached before all expected events are found
 *
 * @example
 * ```ts
 * const events: Array<{ type: string; id: number }> = [];
 * // ... configure telemetry and make request ...
 * await waitForEvents(events, ["start", "headers", "end"]);
 * // Now safe to assert on events
 * ```
 */
export async function waitForEvents(
  events: Array<{ type: string; id?: number; [key: string]: any }>,
  expectedTypes: string[],
  timeoutMs = 500,
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 5; // Poll every 5ms

  while (Date.now() - startTime < timeoutMs) {
    const hasAll = expectedTypes.every(type => events.some(e => e.type === type));
    if (hasAll) {
      return; // Success - all events present
    }
    await Bun.sleep(pollInterval);
  }

  // Timeout - fail with helpful message
  const found = events.map(e => e.type);
  throw new Error(`Timeout waiting for telemetry events. Expected: [${expectedTypes}], Found: [${found}]`);
}

/**
 * Wait for a condition to become true with polling
 * Generic helper for any boolean condition
 *
 * @param condition - Function that returns true when condition is met
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 500ms)
 * @param intervalMs - Polling interval in milliseconds (default: 10ms)
 * @throws Error if timeout is reached before condition becomes true
 */
export async function waitForCondition(condition: () => boolean, timeoutMs = 500, intervalMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);

  while (!condition() && attempts < maxAttempts && Date.now() < deadline) {
    await Bun.sleep(intervalMs);
    attempts++;
  }

  if (!condition()) {
    throw new Error(`Timeout waiting for condition after ${attempts} attempts (${timeoutMs}ms)`);
  }
}

// ---------------------------------------------------------------------------
// Simple circuit breaker — backs off when a service is failing
// ---------------------------------------------------------------------------

interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const circuits = new Map<string, CircuitState>();

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT = 60_000; // 1 minute

/**
 * Check if a circuit is open (service is considered down).
 */
export function isCircuitOpen(name: string): boolean {
  const state = circuits.get(name);
  if (!state || !state.isOpen) return false;

  // Check if enough time has passed to try again (half-open)
  if (Date.now() - state.lastFailure > RESET_TIMEOUT) {
    state.isOpen = false;
    state.failures = 0;
    return false;
  }

  return true;
}

/**
 * Record a successful call — resets the circuit.
 */
export function recordSuccess(name: string): void {
  const state = circuits.get(name);
  if (state) {
    state.failures = 0;
    state.isOpen = false;
  }
}

/**
 * Record a failure — may trip the circuit.
 */
export function recordFailure(name: string): void {
  let state = circuits.get(name);
  if (!state) {
    state = { failures: 0, lastFailure: 0, isOpen: false };
    circuits.set(name, state);
  }
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= FAILURE_THRESHOLD) {
    state.isOpen = true;
  }
}

/**
 * Wrap an async function with circuit breaker logic.
 * Returns fallback value when circuit is open.
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (isCircuitOpen(name)) {
    return fallback;
  }
  try {
    const result = await fn();
    recordSuccess(name);
    return result;
  } catch (err) {
    recordFailure(name);
    throw err;
  }
}

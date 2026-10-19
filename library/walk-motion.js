/** Reflect a moving character at the parent's edges, including large time steps. */
export function advanceWalk(x, direction, distance, min, max) {
  const span = max - min;
  if (span <= 0) return {x: 0, direction};
  const clamped = Math.max(min, Math.min(max, x)) - min;
  const phase = direction > 0 ? clamped : 2 * span - clamped;
  const next = (phase + distance) % (2 * span);
  return {x: next <= span ? min + next : max - (next - span), direction: next < span ? 1 : -1};
}

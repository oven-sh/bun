export interface Walk {
  [Symbol.iterator](): Iterator<number>;
  steps(): Generator<number, void>;
}
export function* count(limit: number): Generator<number, void> {
  for (let step = 0; step < limit; step++) yield step;
}

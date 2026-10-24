export function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

export function swap<T, K extends keyof T>(target: T, a: K, b: K): void {
  const kept = target[a];
  target[a] = target[b];
  target[b] = kept;
}

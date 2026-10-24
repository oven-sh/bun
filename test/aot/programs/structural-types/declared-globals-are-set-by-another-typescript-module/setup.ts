const values: Record<string, unknown> = {
  sharedLimit: "ten",
  sharedTitle: 12,
  sharedPoint: { x: "one" },
  sharedTwice: (n: number) => [n, n],
};

export function install(): void {
  Object.assign(globalThis, values);
}

export function installHonest(): void {
  Object.assign(globalThis, {
    sharedLimit: 10,
    sharedTitle: "title",
    sharedPoint: { x: 1, y: 2 },
    sharedTwice: (n: number) => n * 2,
  });
}

export function remove(): void {
  for (const name of Object.keys(values)) Reflect.deleteProperty(globalThis, name);
}

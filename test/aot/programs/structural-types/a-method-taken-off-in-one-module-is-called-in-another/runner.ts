export function run(title: string, f: () => unknown): string {
  try {
    const value = f();
    return title + ": " + typeof value + " " + String(value);
  } catch (error) {
    return title + ": " + (error instanceof TypeError ? "threw a TypeError" : "threw something else");
  }
}

export function runOn(title: string, f: (this: { count: number }) => number, receiver: { count: number }): string {
  return run(title, () => f.call(receiver));
}

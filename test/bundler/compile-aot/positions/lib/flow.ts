import { thrower, Thing } from "./shapes.ts";

export async function first(kind: string): Promise<void> {
  await null;
  await second(kind);
}

async function second(kind: string): Promise<void> {
  await Promise.resolve();
  const results = await Promise.all([
    third(kind),
  ]);
  void results;
}

const third = async (kind: string) => {
  await 0;
  thrower(kind);
};

export function* gen(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
  thrower("plain");
}

export function viaCallbacks(list: number[]): number[] {
  return list
    .map(x => x * 2)
    .filter(x => {
      if (x > 2) new Thing({ depth: 1 }).method(2);
      return true;
    });
}

export function capture(): string {
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder, capture);
  return holder.stack!;
}

export const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => { throw new Error(strings.join("|") + values.length); };

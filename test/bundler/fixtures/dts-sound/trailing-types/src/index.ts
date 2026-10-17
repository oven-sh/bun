export function pick(from: string): string;
export function pick(from: number): number;
export function pick(from: Either): Either {
  return from;
}

export class Holder {
  constructor(
    private label?: string,
    readonly format?: (text: string) => string,
  ) {}
  show(): string {
    return this.format?.(this.label ?? "") ?? "";
  }
}

declare const box: { chosen?: typeof Holder };
export async function choose(load: () => Promise<{ fallback: unknown }>): Promise<typeof Holder> {
  const found = ("chosen" in box ? box.chosen : (await load()).fallback) as typeof Holder;
  return found;
}

type Either = string | number;

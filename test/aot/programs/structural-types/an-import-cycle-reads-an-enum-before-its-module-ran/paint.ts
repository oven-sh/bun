import { Color, Word } from "./colors.ts";

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value + " " + String(value);
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

export function look(): string {
  return [
    attempt(() => Color.Green),
    attempt(() => Color.Blue + 1),
    attempt(() => Word.Yes),
    attempt(() => Color[5]),
    attempt(() => typeof Color),
    attempt(() => Object.keys(Color).join("+")),
  ].join(", ");
}

export const early: string = look();

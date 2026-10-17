export type { Wide } from "./types";
export function last(names: string[]): string {
  let found = "";
  // @ts-ignore
  if (names.length > 9) found = names.missing;
  const kept: string = found;
  return kept;
}
export function find<T>(list: T[], wanted: T): T {
  if (!list.includes(wanted)) return undefined as any;
  return wanted;
}

export const spread = <
  T extends readonly unknown[],
  R,
>(
  call: (...args: T) => R,
  args: readonly unknown[],
): R =>
  call(
    // @ts-expect-error the arguments are checked by the caller
    ...args,
  );

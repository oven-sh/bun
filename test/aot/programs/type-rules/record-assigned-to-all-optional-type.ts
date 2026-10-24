declare const console: { log(...values: unknown[]): void };
type Options = { mode?: { strict: boolean }; depth?: number };

const NAMES: Record<string, string> = {
  first: "First",
  mode: "Mode",
  last: "Last",
};

function depthOf(options: Options): number {
  return options.depth ?? 0;
}

console.log(depthOf(NAMES), NAMES.first, NAMES.mode, NAMES.last, Object.keys(NAMES).join());

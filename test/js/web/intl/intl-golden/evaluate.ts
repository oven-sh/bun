const show = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? `${v}n` : v === undefined ? "undefined" : v));

/** What an expression may call. */
const helpers = {
  attempt(f: () => unknown) {
    try {
      return f();
    } catch (error: any) {
      return error.name;
    }
  },
  hash: (value: unknown) => Bun.hash.crc32(show(value)),
  range: (from: number, to: number, step = 1) =>
    Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step),
};

export function observe(source: string) {
  const evaluate = new Function(...Object.keys(helpers), `return (${source});`);
  const text = show(helpers.attempt(() => evaluate(...Object.values(helpers))));
  return text.length <= 200 ? text : `${text.length} characters, ${Bun.hash.crc32(text)}`;
}

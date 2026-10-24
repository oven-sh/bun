// A typed function is handed to text that becomes code at run time, and called from there: a literal behind satisfies.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
interface Config { port: number; host: string; tags?: string[] }
const config = { port: 80, host: "h", tags: ["a"] } satisfies Config;
function probe(c: typeof config): number {
  return c.port + c.host.length + c.tags.length;
}
console.log(open(probe)(config));

// A generic forwarder builds `{ ...opts, context, may } as P` (P extends Base) and passes it to a function it received as an
// argument. The function's parameter is a wider record type, named or written in place and destructured.
type Ctx = { id: number; round?: number };
type Base = { context: Ctx; may?: (name: string) => boolean };
type ResumeArgs = { context: Ctx; may?: (name: string) => boolean; agent: string; reply: string };
let last: unknown = null;
function inner<P extends Base, R>(engine: (opts: P) => R, all: P): R {
  last = all;
  return engine(all);
}
function run<P extends Base, R>(context: Ctx, engine: (opts: P) => R, opts: Omit<P, keyof Base>): R {
  return inner(engine, { ...opts, context, may: (n: string) => n !== "no" } as P);
}
function launch({ input, context, may, message, timing, parent, depth }: { context: Ctx; may?: (name: string) => boolean; input: string; message: string; timing?: number; parent?: string; depth: number }): string {
  return [input, context.id, may?.("x"), message, timing ?? "-", parent ?? "-", depth].join(" ");
}
function resume(args: ResumeArgs): string {
  args.reply += "!";
  return [args.agent, args.context.id, args.may?.("no"), args.reply, (args as unknown) === last].join(" ");
}
async function later({ input, context }: { context: Ctx; may?: (name: string) => boolean; input: string }): Promise<string> {
  await null;
  return input + context.id;
}
console.log(run({ id: 1 }, launch, { input: "i", message: "m", timing: 3, depth: 1 }));
console.log(run({ id: 2, round: 4 }, launch, { input: "j", message: "n", depth: 2 }));
console.log(run({ id: 3 }, resume, { agent: "a", reply: "r" }), (last as ResumeArgs).reply);
console.log(await run({ id: 4 }, later, { input: "k" }));

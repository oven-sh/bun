// A generic builder merges defaults with a definition and casts the result to a type that depends on the type parameter.
const DEFAULTS = { isActive: () => true, isSafe: (_input?: unknown) => false, isPassive: (_input?: unknown) => false, label: (_input?: unknown) => "" };
type Defaults = typeof DEFAULTS;
type Keys = keyof Defaults;
interface AnyDef { name: string; create(deps: number): { run(): string }; isActive?(): boolean; isSafe?(input: unknown): boolean; isPassive?(input: unknown): boolean; label?(input: unknown): string }
type Built<D> = Omit<D, Keys | "create"> & { [K in Keys]-?: K extends keyof D ? (undefined extends D[K] ? Defaults[K] : D[K]) : Defaults[K] } & { run(): string };
interface Plugin { name: string; isActive(): boolean; isSafe(input: unknown): boolean; isPassive(input: unknown): boolean; label(input: unknown): string; run(): string }
function build<D extends AnyDef>(def: D): Built<D> {
  const create = def.create;
  const facing = { run: () => create.call(def, 1).run() };
  const built: Plugin = Object.assign(Object.defineProperties({ ...DEFAULTS, label: () => def.name }, Object.getOwnPropertyDescriptors(def)), facing) as unknown as Plugin;
  return built as unknown as Built<D>;
}
export const first = build({ name: "first", create: () => ({ run: () => "ran first" }), isSafe: () => true as const });
export const second = build({ name: "second", create: () => ({ run: () => "ran second" }), label: (input: unknown) => String(input) });
export const third = build({ name: "third", create: () => ({ run: () => "ran third" }) });
console.log(first.name, first.isSafe(), first.isActive(), first.run(), second.label(7), second.isSafe(1), third.isPassive(), third.run());

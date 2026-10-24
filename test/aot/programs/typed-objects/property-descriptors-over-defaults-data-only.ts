// The same overlay with property descriptors as in property-descriptors-over-defaults, without an accessor in the definition.
const UNSUPPORTED = { supported: false } as const;
const DEFAULTS = { isActive: () => true, isPassive: () => false, remote: UNSUPPORTED, limit: 10 };
interface Spec { supported: boolean; fields?: string[] }
interface Plugin { name: string; isActive(): boolean; isPassive(): boolean; remote: Spec; limit: number; label(): string; run(): string; readonly schema: string }
type Def = { name: string; remote?: Spec; limit?: number; readonly schema: string };
function build<D extends Def>(def: D): Plugin {
  const actions = { run: () => "ran " + def.name };
  const built: Plugin = Object.assign(Object.defineProperties({ ...DEFAULTS, label: () => def.name }, Object.getOwnPropertyDescriptors(def)), actions) as unknown as Plugin;
  return built;
}
let made = 0;
const a = build({ name: "read", remote: { supported: true, fields: ["path"] }, schema: "s0" });
const b = build({ name: "plain", limit: 3, schema: "fixed" });
console.log(a.name, a.remote.supported, a.remote.fields?.join(), a.limit, a.isActive(), a.label(), a.run(), made, a.schema, a.schema, made);
console.log(b.name, b.remote.supported, b.limit, b.schema, Object.keys(b).join());

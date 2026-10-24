export const direct = "direct";
export const directUnused = "unused";
const local = "renamed";
const localUnused = "unused";
export { local as renamed, localUnused as renamedUnused };
const spaced = "quoted";
export { spaced as "quoted name" };
export class Klass { name() { return "Klass"; } }
export class KlassUnused {}
export enum Kind { A = "a" }
export enum KindUnused { A = "a" }
export const { fromPattern, fromPatternUnused } = { fromPattern: "from a pattern", fromPatternUnused: 1 };
export const [fromArray] = ["from an array pattern"];
const theDefault = { kind: "default" };
export default theDefault;
export const viaStar = "through export *";
export const forNamedBarrel = "through a named re-export";
export const viaNamespaceExport = "through export * as";
export const viaNamespace = "through a namespace import";
export const viaImportEquals = "through import = require";
export const viaRequire = "through require";
export const viaImportCall = "through import()";

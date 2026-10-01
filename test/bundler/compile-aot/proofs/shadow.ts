import { plain } from "./lib";
export function helper() { return "module helper"; }
// A variable of the function's own with the name of the module's, captured, so that it lives in a scope.
export function ownShadow() { let helper = () => "own helper"; const keep = () => helper; return helper() + "/" + keep()(); }
// One in a scope in between.
export function between() { let helper = () => "between helper"; return (() => helper())(); }
// A parameter.
export function parameter(helper: () => string) { return (() => helper())() + "/" + helper(); }
// An import that is shadowed.
export function shadowedImport() { const plain = (a: number, b: number) => a * b; return (() => plain(3, 4))() + "," + plain(3, 4); }
export function notShadowed() { return helper() + "," + plain(3, 4) + "," + (() => helper())(); }
// In a block at the top of the module.
export let fromBlock = "";
{ let helper = () => "block helper"; const keep = () => helper(); fromBlock = helper() + "/" + keep(); }

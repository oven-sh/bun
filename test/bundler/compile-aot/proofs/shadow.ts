import { plain } from "./lib";
export function helper() { return "module helper"; }
export function ownShadow() { let helper = () => "own helper"; const keep = () => helper; return helper() + "/" + keep()(); }
export function between() { let helper = () => "between helper"; return (() => helper())(); }
export function parameter(helper: () => string) { return (() => helper())() + "/" + helper(); }
export function shadowedImport() { const plain = (a: number, b: number) => a * b; return (() => plain(3, 4))() + "," + plain(3, 4); }
export function notShadowed() { return helper() + "," + plain(3, 4) + "," + (() => helper())(); }
export let fromBlock = "";
{ let helper = () => "block helper"; const keep = () => helper(); fromBlock = helper() + "/" + keep(); }

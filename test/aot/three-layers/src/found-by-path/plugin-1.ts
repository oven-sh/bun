import { middleText } from "../settings";
(globalThis as any).loadsOfPlugin1 = ((globalThis as any).loadsOfPlugin1 ?? 0) + 1;
export const readByNobodyHere = "an export that no file reads by its name";
export const sameText = () => middleText;
export let calls = 0;
export function call() { return ++calls; }
export class Plugin { name = "plugin 1"; describe() { return this.name + " of " + middleText; } }
export default { kind: "default of plugin 1" };

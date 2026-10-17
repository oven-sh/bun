declare const injected: number;
declare function require(name: string): { sep: string };
export const second = (): number => injected + require("node:path").sep.length;

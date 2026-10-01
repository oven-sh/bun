let n = 0;
const seen: string[] = [];
export function bump(who: string): string { seen.push(who); return `${++n}:${seen.join("")}`; }
export class Box { static made = 0; id = ++Box.made; }
export const re = /x+/g;
console.log("evaluated");

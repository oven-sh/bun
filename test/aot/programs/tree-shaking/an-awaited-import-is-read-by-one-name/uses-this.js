export function start() { return "start, " + this.other() + ", " + this.constant; }
export function other() { return "other"; }
export const constant = "a constant read through this";

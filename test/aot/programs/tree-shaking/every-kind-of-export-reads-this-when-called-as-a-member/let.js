export let start = function () { return "let, " + this.other(); };
export function other() { return "other"; }

export function target() { return "target before eval"; }
export function run() { eval("target = function () { return 'target after eval'; }"); }
export function call() { return target(); }

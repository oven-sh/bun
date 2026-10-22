export function plain() { return "plain"; }
function local() { return "escaped export"; }
export { local as escapedExport };
export function both() { return "both"; }
export function member() { return "member"; }
export function unused() { return "unused"; }

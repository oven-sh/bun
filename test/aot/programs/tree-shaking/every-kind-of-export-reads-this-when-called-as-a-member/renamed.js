function local() { return "renamed, " + this.other(); }
export { local as start };
export function other() { return "other"; }

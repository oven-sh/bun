const holder = { method() { return "from an object, " + this.other(); } };
export const { method: start } = holder;
export function other() { return "other"; }

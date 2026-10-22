export class Widget { run() { return "widget runs"; } }
export class Gadget { run() { return "gadget runs"; } }
export function makeGadget() { return new Gadget(); }
export interface Shape { sides: number }
export function Shape(): Shape { return { sides: count() }; }
function count() { return 4; }

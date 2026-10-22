export const enum Flag { Off = 0, On = 1 }
export enum Kind { Circle, Square }
function nameOf(kind: Kind) { return Kind[kind].toLowerCase(); }
export function describeKind(kind: Kind) { return "kind " + nameOf(kind); }

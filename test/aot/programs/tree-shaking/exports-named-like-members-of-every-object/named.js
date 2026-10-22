export function toString() { return "toString by name"; }
export function valueOf() { return "valueOf by name"; }
export function constructor() { return "constructor by name"; }
export function hasOwnProperty(key) { return "hasOwnProperty of " + key; }
function proto() { return "__proto__ by name"; }
export { proto as __proto__ };
export function isPrototypeOf() { return "isPrototypeOf by name"; }

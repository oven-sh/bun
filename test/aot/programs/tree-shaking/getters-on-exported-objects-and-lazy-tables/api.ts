function viaGetter() { return "via a getter"; }
function viaMethod() { return "via a method"; }
function viaProperty() { return "via a property"; }
function inMap() { return "in a Map"; }
function first() { return "first of a list"; }
function last() { return "last of a list"; }
function late() { return "late"; }
function deep() { return "deep"; }

export const api = {
  get viaGetter() { return viaGetter; },
  viaMethod() { return viaMethod(); },
  viaProperty,
};
export const table = new Map([["entry", inMap]]);
export const list = [first, last];
export function lazy() { return { late }; }
export const nested = { a: { b: { c: deep } } };

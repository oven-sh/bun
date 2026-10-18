export const kept = [];
export function probe(object) {
  const names = [];
  for (const name in object) names.push(name);
  return [Object.keys(object).join(), names.join(), typeof object.before, typeof object.after, "after" in object, Object.hasOwn(object, "after")].join(" ");
}
export function keep(value) {
  kept.push(value);
  return kept.length;
}
/** @returns {number | undefined} */
export function fail(message) {
  throw new Error(message);
}
export function choose(value) {
  return value;
}
export function anything(value) {
  return value;
}

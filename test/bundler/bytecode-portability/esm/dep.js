export let count = 0;
export function tally(n) {
  for (let i = 0; i < n; i++) count++;
  return count;
}
export default class Dep {
  static #made = 0;
  static make() {
    return ++Dep.#made;
  }
}

// A JSDoc comment that TypeScript cannot parse (Closure's `function(): T` in a @typedef, as in webpack's sources) is a comment: the file is valid JavaScript and is built.
/** @template T @typedef {function(): T} FunctionReturning */
/** @typedef {function(string, number=): void} Callback */
/**
 * @template T
 * @param {FunctionReturning<T>} fn memorized function
 * @returns {FunctionReturning<T>} new function
 */
const memoize = fn => {
  let cache = false;
  /** @type {T | undefined} */
  let result = undefined;
  return () => {
    if (cache) return /** @type {T} */ (result);
    result = fn();
    cache = true;
    fn = undefined;
    return /** @type {T} */ (result);
  };
};
let calls = 0;
const five = memoize(() => (calls++, 5));
console.log(five(), five(), calls);

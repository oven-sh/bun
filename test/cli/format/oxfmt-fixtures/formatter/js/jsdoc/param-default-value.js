/**
 * @typedef {Int8Array | Uint8Array} TypedArray A union type representing all
 *   possible TypedArrays.
 */

/**
 * @template {TypedArray} [T=Typed<TypedArray>] Desc. Default is
 *   `Typed<TypedArray>`
 * @typedef {T} Typed A generic type representing a TypedArray.
 */

/**
 * @param {string} x The string to parse as a number
 * @param {boolean} [int=true] Whether to parse as an integer or float. Default
 *   is `true`.
 * @returns {number} The parsed number
 */
function parseNumber(x, int) {}

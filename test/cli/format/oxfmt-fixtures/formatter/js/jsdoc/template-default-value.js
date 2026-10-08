/**
 * @template {string} [T=string] - The type parameter with a default.
 */
function foo() {}

/**
 * @param {number} [x=10] - The parameter with a default value.
 */
function bar(x) {}

/**
 * @template {TypedArray} [T=Typed] Description text. Default is `X`.
 */
function baz() {}

/**
 * @param {number} [x=10] - The param description. Default is `10`.
 */
function qux(x) {}

/**
 * @param {number} [x=10] - A long description that should wrap to the next line when exceeded. Default is `10`.
 */
function wrapping(x) {}

// Code starting with curly braces in @example should be treated as
// JSON-like, not JS. Upstream (utils.ts:248-274) tries JSON parser for
// brace-starting code and falls back to keeping original if it fails.

/**
 * Pseudo-code should not be reformatted as JS
 *
 * @example
 *   {undefined}('popup', 'options');
 */
function pseudoCode() {}

/**
 * JSON-like object should preserve quoted keys
 *
 * @example
 *   { "testing": "src/utils/testing.ts" }
 */
function jsonLike() {}

/**
 * Valid object literal should still be formatted
 *
 * @example
 *   {key: "value", another: 42}
 */
function validObject() {}

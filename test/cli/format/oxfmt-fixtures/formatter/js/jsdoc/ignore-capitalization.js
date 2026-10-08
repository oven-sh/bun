// Fix 15: @ignore with blank-line separator should not apply named-tag capitalization

/**
 * @ignore
 *
 * `@hidden` and `@ignore` mark a reflection as not being documented.
 */
function internalHelper() {}

/**
 * @ignore
 *
 * some description after blank line
 */
function anotherHelper() {}

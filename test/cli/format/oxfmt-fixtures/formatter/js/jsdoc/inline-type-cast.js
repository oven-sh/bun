// Fix 26: Inline @type cast comments should not be expanded to multi-line

const x = /** @type {ESTree.FunctionExpression | ESTree.ArrowFunctionExpression} */ (fn.init);

const y = /** @type {string} */ (value);

// Multi-line @type (not inline cast) should still be formatted:
/**
 * @type {string}
 */
let z;

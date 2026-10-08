const curlyBraces = /** @type {string} */ (foo);
const curlyBraces2 = /**@type {string} */ (foo);
const noWhitespace = /** @type{string} */ (foo);
const noWhitespace2 = /**@type{string} */ (foo);
const noBraces = /** @type string */ (foo);
const parens = /** @type (string | number) */ (foo);

// Prettier just searches for "@type" and doesn't check the syntax of types.
const v1 = /** @type {} */ (value);
const v2 = /** @type {}} */ (value);
const v3 = /** @type } */ (value);
const v4 = /** @type { */ (value);
const v5 = /** @type {{} */ (value);

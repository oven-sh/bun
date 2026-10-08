// Upstream (prettier-plugin-jsdoc) unconditionally adds a blank line
// between description and first tag.

/**
 * This is a description.
 * @param {string} name - The name
 */
function addBlankLine(name) {}

/**
 * Description text here.
 * @see https://example.com
 */
function addBlankBeforeSee() {}

/**
 * Some description.
 * @deprecated Use something else
 */
function addBlankBeforeDeprecated() {}

// When the original already has a blank line, it stays:
/**
 * Description with blank line.
 *
 * @param {string} x - Value
 */
function preservedBlankLine(x) {}

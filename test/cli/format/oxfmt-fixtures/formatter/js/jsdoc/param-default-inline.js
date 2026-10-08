// Fix 8: Default value should be appended inline in multi-line @param descriptions

/**
 * @param {string} x The string to parse as a number
 * @param {boolean} [int=true] Whether to parse as an integer or float
 * @returns {number} The parsed number
 */
function parseNumber(x, int) {}

/**
 * @param {string} [format="json"] The output format to use for serialization. Supports json, xml, and csv
 */
function serialize(format) {}

/**
 * @param {number} [timeout=3000] The timeout. Default is `3000`
 */
function withExistingDefault(timeout) {}

// Fix 17: @param with dash separator and description on next line

/**
 * @param {ActiveElement[]} lastActive -
 *   Previously active elements
 */
function update(lastActive) {}

// Dash with description on same line (should stay the same)
/**
 * @param {string} name - The user name
 */
function greet(name) {}

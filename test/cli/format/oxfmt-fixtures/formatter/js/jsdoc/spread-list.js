// Spread (loose) lists: blank lines between items should be preserved

/**
 * Features:
 *
 * - Complex method signatures
 *
 * - Static methods
 *
 * - A method with 10 overload signatures
 */
const a = 1;

// Mixed: spread list with nested sub-list
/**
 * Features:
 *
 * - Complex method signatures
 * - Static methods
 * - A method with 10 overload signatures. Wow!
 *
 *   - Only the implementation signature has a doc comment. TypeDoc automatically
 *     copies the comment from the implementation signature to each of the
 *     visible signatures if they don't have one.
 *
 * A promise with a `cancel` method.
 */
const b = 2;

// Tight (non-spread) list: no blank lines between items
/**
 * Features:
 *
 * - Complex method signatures
 * - Static methods
 * - A method with 10 overload signatures
 */
const c = 3;

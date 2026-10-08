// Fenced code block immediately before @returns — no extra blank line
/**
 * @param paramA This is a **parameter** pointing to an interface.
 *
 *       const value = new BaseClass("test");
 *       functionWithArguments("arg", 0, value);
 * @returns This is the return value of the function.
 */
function foo() {}

// Fenced code block before @returns with explicit blank line
/**
 * @param paramA Description.
 *
 *       const x = 1;
 *
 * @returns The result.
 */
function bar() {}

// Non-code-block param before @returns (should stay as-is)
/**
 * @param paramA Description text here.
 * @returns The result.
 */
function baz() {}

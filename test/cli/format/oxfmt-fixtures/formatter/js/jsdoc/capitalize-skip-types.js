/**
 * @fires {CustomEvent<{ id: string }>}
 */
function foo() {}

/**
 * @fires {CustomEvent<{ id: string }>} when the item is clicked
 */
function bar() {}

/**
 * @fires myEvent some description here
 */
function baz() {}

/**
 * @augments {Set<string>} some description
 */
class Bar {}

/**
 * @augments {CustomEvent<{ id: string }>} some description here
 */
class Baz {}

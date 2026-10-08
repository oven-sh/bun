// Issue #22043 - line comment followed by block comment after type alias equals
type myType = // Comment1
/* Comment2 */ "VALUE";

// Type reference right-hand side
type TypeRef = // Comment1
/* Block2 */ SomeType;

// Conditional type aliases keep Prettier's existing trailing placement.
type ConditionalLine = // Comment
Foo<T> extends Bar ? Baz : Qux;
type ConditionalLineBlock = // Comment1
/* Block2 */ Foo<T> extends Bar ? Baz : Qux;

// Value assignments and assignment expressions move the line comment to the
// end of line, reordering it past the block comment and value. This is likely
// not intentional but we match Prettier here until the upstream behavior settles
// (see prettier/prettier#14617).
const value = // Comment1
/* Comment2 */ "VALUE";

let target;
target = // Comment1
/* Comment2 */ "VALUE";

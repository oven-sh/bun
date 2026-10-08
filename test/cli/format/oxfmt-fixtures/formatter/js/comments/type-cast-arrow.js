items.map((child) => /** @type {SomeType} */ (visit(child)));

transform_body(first_argument, second_argument, (node) => /** @type {Node} */ (context.visit(node)));

// #20180 Arrow function body breaks after => when JSDoc type cast is in body
const longer_variable = items_with_longer_name.map((child) => /** @type {SomeTypeThatIsLonger} */ (visit(child)));

const body = transform_body(state.analysis.instance_body, b.id("$.run"), (node) => /** @type {Node} */ (context.visit(node)));

// Edge case: very long type cast that doesn't fit even after expanding arguments
const x = items_with_longer_name.map((child) => /** @type {SomeVeryVeryVeryVeryVeryVeryVeryLongType} */ (visit(child)));

// No false positive: type cast earlier in file should not affect unrelated arrow
const a = /** @type {X} */ (foo());
const result = items_with_longer_name.map((child) => bar_without_typecast(child));

// @satisfies type cast
const z = items_with_longer_name.map((child) => /** @satisfies {SomeTypeThatIsLonger} */ (visit(child)));

// Optional chaining with type cast
const w = items_with_longer_name.map((child) => /** @type {SomeTypeThatIsLonger} */ (child?.visit()));

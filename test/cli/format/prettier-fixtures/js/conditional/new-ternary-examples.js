// from https://gist.github.com/rattrayalex/dacbf5838571a47f22d0ae1f8b960268
// Input and output should match (for 2-space indent formatting).
// TypeScript is here: prettier/tests/format/typescript/conditional-types/new-ternary-spec.ts
// EXAMPLES
//  mostly taken from https://github.com/prettier/prettier/issues/9561

const message =
  i % 3 === 0 && i % 5 === 0 ? "fizzbuzz"
  : i % 3 === 0 ? "fizz"
  : i % 5 === 0 ? "buzz"
  : String(i);

const paymentMessageShort =
  state == "success" ? "Payment completed successfully"
  : state == "processing" ? "Payment processing"
  : state == "invalid_cvc" ? "There was an issue with your CVC number"
  : state == "invalid_expiry" ? "Expiry must be sometime in the past."
  : "There was an issue with the payment.  Please contact support.";

const paymentMessageWithABreak =
  state == "success" ? "Payment completed successfully"
  : state == "processing" ? "Payment processing"
  : state == "invalid_cvc" ?
    "There was an issue with your CVC number, and you need to take a prompt action on it."
  : state == "invalid_expiry" ? "Expiry must be sometime in the past."
  : "There was an issue with the payment.  Please contact support.";

const typeofExample =
  definition.encode ?
    definition.encode(
      typeof row[field] !== "undefined" ? row[field]
      : typeof definition.default !== "undefined" ? definition.default
      : null,
    )
  : typeof row[field] !== "undefined" ? row[field]
  : typeof definition.default !== "undefined" ? definition.default
  : null;

// (the following is semantically equivalent to the above, but written in a more-confusing style – it'd be hard to grok no matter the formatting)
const typeofExampleFlipped =
  definition.encode ?
    definition.encode(
      typeof row[field] === "undefined" ?
        typeof definition.default === "undefined" ?
          null
        : definition.default
      : row[field],
    )
  : typeof row[field] === "undefined" ?
    typeof definition.default === "undefined" ?
      null
    : definition.default
  : row[field];

// JSX Examples:

const typicalLongConsequentWithNullAlternate = (
  <div>
    {children && !isEmptyChildren(children) ?
      <FooComponent
        className="a bunch of css classes might go here, wow so many"
        foo={foo}
        bar={includeBar ? bar : null}
      />
    : null}
  </div>
);

const reactRouterExampleJSX = (
  <div>
    {children && !isEmptyChildren(children) ?
      children
    : props.match ?
      component ?
        React.createElement(component, props)
      : render ?
        render(props)
      : null
    : null}
  </div>
);

const reactRouterExampleNonJSX =
  children && !isEmptyChildren(children) ? children
  : props.match ?
    component ? React.createElement(component, props)
    : render ? render(props)
    : null
  : null;

inJSXExpressionContainer.withLongConditionals.example = (
  <div>
    {isACat() && (someReallyLongCondition || moreInThisLongCondition) ?
      someReallyLargeExpression.toMakeMeowNoise().willCauseParens()
    : someReallyLongCondition || moreInThisLongCondition ?
      bark()
    : someReallyLargeExpression.toMakeMeowNoise().willCauseParens()}
  </div>
);

inJSXExpressionContainer.withLoops.orBooleans.example = (
  <div>
    {items ?
      items.map((item) =>
        item.display ?
          <Item item={item} attr="breaks ternary but not consequent" />
        : <Blank />,
      )
    : null}

    {showTheStuff &&
      (foo ?
        <Thing thing={foooooooooooooooooooooooooo} bar="bazzzzzz" />
      : <OtherThing />)}
  </div>
);

inJSXExpressionContainer.withNullConditional = (
  <div>
    {isACat() ? null : <Foo />}
    {isACat() && (someReallyLongCondition || moreInThisLongCondition) ? null : (
      <Foo />
    )}
    {(
      isACat() &&
      (someReallyLongCondition ||
        moreInThisLongCondition ||
        evenMoreInThisExtraLongConditional)
    ) ?
      null
    : <Foo />}
  </div>
);

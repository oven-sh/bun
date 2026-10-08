// from https://gist.github.com/rattrayalex/dacbf5838571a47f22d0ae1f8b960268
// Input and output should match (for 2-space indent formatting).
// TypeScript is here: prettier/tests/format/typescript/conditional-types/new-ternary-spec.ts

// remain on one line if possible:
const short = isLoud() ? makeNoise() : silent();

// next, put everything after the =
const lessShort =
  isLoudReallyLoud() ? makeNoiseReallyLoudly.omgSoLoud() : silent();

// next, indent the consequent:
const andIndented =
  isLoudReallyReallyReallyReallyLoud() ?
    makeNoiseReallyReallyReallyReallyReallyLoudly.omgSoLoud()
  : silent();

// unless the consequent is short (less than ten characters long):
const shortSoCase =
  isLoudReallyReallyReallyReallyLoud() ? silent() : (
    makeNoiseReallyReallyReallyReallyReallyLoudly.omgSoLoud()
  );

// if chained, always break and put after the =
const chainedShort =
  isCat() ? meow()
  : isDog() ? bark()
  : silent();

// when a consequent breaks in a chain:
const chainedWithLongConsequent =
  isCat() ?
    someReallyLargeExpression
      .thatWouldCauseALineBreak()
      .willCauseAnIndentButNotParens()
  : isDog() ? bark()
  : silent();

// nested ternary in consequent always breaks:
const chainedWithTernaryConsequent =
  isCat() ?
    aNestedCondition ? theResult()
    : theAlternate()
  : isDog() ? bark()
  : silent();

// consequent and terminal alternate break:
const consequentAndTerminalAlternateBreak =
  isCat() ?
    someReallyLargeExpression
      .thatWouldCauseALineBreak()
      .willCauseAnIndentButNotParens()
  : isDog() ? bark()
  : someReallyLargeExpression
      .thatWouldCauseALineBreak()
      .willCauseAnIndentButNotParens();

// multiline conditions and consequents/alternates:
const multilineConditionsConsequentsAndAlternates =
  (
    isAnAdorableKittyCat() &&
    (someReallyLongCondition || moreInThisLongCondition)
  ) ?
    someReallyLargeExpression
      .thatWouldCauseALineBreak()
      .willCauseAnIndentButNotParens()
  : (
    isNotAnAdorableKittyCat() &&
    (someReallyLongCondition || moreInThisLongCondition)
  ) ?
    bark()
  : shortCondition() ? shortConsequent()
  : someReallyLargeExpression
      .thatWouldCauseALineBreak()
      .willCauseAnIndentButNotParens();

// illustrating case of mostly short conditionals
const mostlyShort =
  x === 1 ? "one"
  : x === 2 ? "two"
  : x === 3 ? "three"
  : (
    x === 5 &&
    y === 7 &&
    someOtherThing.thatIsSoLong.thatItBreaksTheTestCondition()
  ) ?
    "four"
  : x === 6 ? "six"
  : "idk";

// long conditional, short consequent/alternate, not chained - do indent after ?
const longConditional =
  (
    bifornCringerMoshedPerplexSawder === 2 / askTrovenaBeenaDependsRowans &&
    glimseGlyphsHazardNoopsTieTie >=
      averredBathersBoxroomBuggyNurl().anodyneCondosMalateOverateRetinol()
  ) ?
    "foo"
  : "bar";

// long conditional, short consequent/alternate, chained
// (break on short consequents iff in chained ternary and its conditional broke)
const longConditionalChained =
  (
    bifornCringerMoshedPerplexSawder === 2 / askTrovenaBeenaDependsRowans &&
    glimseGlyphsHazardNoopsTieTie >=
      averredBathersBoxroomBuggyNurl().anodyneCondosMalateOverateRetinol()
  ) ?
    "foo"
  : anotherCondition ? "bar"
  : "baz";

// As a function parameter, don't add an extra indent:
definition.encode(
  typeof row[field] !== "undefined" ? row[field]
  : typeof definition.default !== "undefined" ? definition.default
  : null,
  typeof row[field] === "undefined" ?
    typeof definition.default === "undefined" ?
      null
    : definition.default
  : row[field],
);

// In a return, break and over-indent:
const inReturn = () => {
  if (short) {
    return foo ? 1 : 2;
  }
  return typeof row[aVeryLongFieldName] !== "undefined" ?
      row[aVeryLongFieldName]
    : null;
};

// Remove current JSX Mode, and replace it with this algorithm:
// When a ternary's parent is a JSXExpressionContainer which is not in a JSXAttribute,
// force the consequent to break,
// and if the alternate breaks,
// add a newline before the closing curly brace.
// Special case when the consequent is `null`:
// do not add a line before or after it,
// and wrap the alternate in parens.

const someJSX = (
  <div>
    Typical jsx case:
    {showFoo ?
      <Foo attribute="such and such stuff here" />
    : <Bar short />}
    Nested, and with a non-jsx consequent is the same:
    {component ?
      React.createElement(component, props)
    : render ?
      <div>{render(props)}</div>
    : <div>Nothing is here</div>}
    As is a non-jsx consequent:
    {showTheJSXElement ?
      <div>the stuff</div>
    : renderOtherStuff()}
    But if the alternate breaks, add a newline before the closing curly brace:
    {showTheThing || pleaseShowTheThing ?
      <Foo attribute="such and such stuff here" />
    : <Bar
        attribute="such and such stuff here"
        another="more stuff here"
        third="and even more, hooray!"
      />
    }
    When the consequent is `null` and the alternate breaks,
    hug it with parens to match boolean behavior:
    {!thing ? null : (
      <TheThing
        thing={thing}
        someVeryLongPropertyThatBreaksTheAlternate="hello"
      />
    )}
  </div>
);

ternaryWithJSXElements.hasNoSpecialCasing =
  component ? <div>{React.createElement(component, props)}</div>
  : render ? <div>{render(props)}</div>
  : <div>Nothing is here</div>;

jsxExpressionContainer.inJSXAttribute.hasNoSpecialCasing = (
  <Foo
    withJSX={isRed ? <RedColorThing /> : <GreenColorThing />}
    withJSXBroken={
      isRed || isSomeOtherLongCondition.thatBreaksTheLine() ?
        <RedColorThing />
      : <GreenColorThing />
    }
  />
);

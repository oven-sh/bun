// test to make sure comments are attached correctly
let inlineComment = /* some comment */ (
  someReallyLongFunctionCall(withLots, ofArguments));

let object = {
  key: /* some comment */ (someReallyLongFunctionCall(withLots, ofArguments))
};

// preserve parens only for type casts
let assignment = /** @type {string} */ (getValue());
let value = /** @type {string} */ (this.members[0]).functionCall();

functionCall(1 + /** @type {string} */ (value), /** @type {!Foo} */ ({}));

function returnValue() {
  return /** @type {!Array.<string>} */ (['hello', 'you']);
}

// Only numberOrString is typecast
var newArray = /** @type {array} */ (numberOrString).map(x => x);
var newArray = /** @type {array} */ ((numberOrString)).map(x => x);
var newArray = test(/** @type {array} */ (numberOrString).map(x => x));
var newArray = test(/** @type {array} */ ((numberOrString)).map(x => x));

// The numberOrString.map CallExpression is typecast
var newArray = /** @type {array} */ (numberOrString.map(x => x));
var newArray = /** @type {array} */ ((numberOrString).map(x => x));
var newArray = test(/** @type {array} */ (numberOrString.map(x => x)));
var newArray = test(/** @type {array} */ ((numberOrString).map(x => x)));

test(/** @type {number} */(num) + 1);
test(/** @type {!Array} */(arrOrString).length + 1);
test(/** @type {!Array} */((arrOrString)).length + 1);

const data = functionCall(
  arg1,
  arg2,
  /** @type {{height: number, width: number}} */ (arg3));

const style = /** @type {{
  width: number,
  height: number,
  marginTop: number,
  marginLeft: number,
  marginRight: number,
  marginBottom: number,
}} */ ({
  width,
  height,
  ...margins,
});

const style2 =/**
 * @type {{
 *   width: number,
 * }}
*/({
  width,
});


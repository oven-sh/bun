function jsx() {
  return (
    // Comment
    <div />
  );
}

function unary() {
  return (
    // Comment
    !!x
  );
}

function numericLiteralNoParen() {
  return 1337; // Comment
}

function logical() {
  return (
    // Reason for 42
    42
  ) && 84
}

function binary() {
  return (
    // Reason for 42
    42
  ) * 84
}

function binaryInBinaryLeft() {
  return (
    // Reason for 42
    42
  ) * 84 + 2
}

function binaryInBinaryRight() {
  return (
    // Reason for 42
    42
  ) + 84 * 2
}

function conditional() {
  return (
    // Reason for 42
    42
  ) ? 1 : 2
}

function binaryInConditional() {
  return (
    // Reason for 42
    42
  ) * 3 ? 1 : 2
}

function call() {
  return (
    // Reason for a
    a
  )()
}

function memberInside() {
  return (
    // Reason for a.b
    a.b
  ).c
}

function memberOutside() {
  return (
    // Reason for a
    a
  ).b.c
}

function memberInAndOutWithCalls() {
  return (
    // Reason for a
    aFunction.b()
  ).c.d()
}

function excessiveEverything() {
  return (
    // Reason for stuff
    a.b() * 3 + 4 ? (a`hi`, 1) ? 1 : 1 : 1
  )
}

// See https://github.com/prettier/prettier/issues/2392
// function sequenceExpression() {
//   return (
//     // Reason for a
//     a
//   ), b
// }

function sequenceExpressionInside() {
  return ( // Reason for a
    a, b
  );
  throw ( // Reason for a
    a, b
  );
  return ( // Reason for a
    a = 1
  );
}

function taggedTemplate() {
  return (
    // Reason for a
    a
  )`b`
}

function inlineComment() {
  return (
    /* hi */ 42
  ) || 42
}

function multilineBlockSameLine() {
  return (
    /**
    * @type {string}
    */ 'result'
  )
}

function multilineBlockNextLine() {
  return (
    /**
    * @type {string}
    */
    'result'
  )
}

function multilineBlockSameLineJsx() {
  return (
    /**
    * JSX Same line
    */ <div></div>
  )
}

function multilineBlockNextLineJsx() {
  return (
    /**
    * JSX Next line
    */
    <div></div>
  )
}

function singleLineBlockSameLine() {
  return (
    /** Result -> */ 'result'
  )
}

function singleLineBlockNextLine() {
  return (
    /** Result below */
    'result'
  )
}

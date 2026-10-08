!left &&
/** @type {boolean} */
(
  /** @type {Identifier} */
  (a) === "call" ||
    /** @type {Identifier} */
    (b) === "bind"
//  ^^^^^^^^^^^^^^ No need to wrap with parentheses here because the type cast node is already wrapped with parentheses.
) && right;

/** @type {Number} */ (a + b)();
//                    ^^^^^^^ No need to wrap with parentheses here because the type cast node is already wrapped with parentheses.

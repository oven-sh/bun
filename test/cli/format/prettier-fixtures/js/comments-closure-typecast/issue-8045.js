const myLongVariableName = /** @type {ThisIsAVeryLongTypeThatShouldTriggerLineWrapping} */ (fooBarBaz);

function jsdocCastInReturn() {
  return /** @type {ThisIsAVeryLongTypeThatShouldTriggerLineWrapping} */ (fooBarBaz);
}

const myLongVariableFoo1 = /** @type {ThisIsAVeryLongTypeThatShouldTriggerLineWrapping} */
      (fooBarBaz);

function jsdocCastInReturn() {
  return (/** @type {ThisIsAVeryLongTypeThatShouldTriggerLineWrapping} */
    (fooBarBaz));
}

const myLongVariableFoo2 = /** @type {ThisIsAVeryLongTypeThatShouldTriggerLineWrapping} */
      (fooBarBaz);

function jsdocCastInReturn() {
  return (/** @type {ThisIsAVeryLongTypeThatShouldTriggerLineWrapping} */
    (fooBarBaz));
}

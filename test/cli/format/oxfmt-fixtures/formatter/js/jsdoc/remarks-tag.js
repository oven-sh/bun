/**
 * @remarks Remarks
 */
const a = 1;

/**
 * @remarks
 * This is a multi-line remark
 * that should not be treated as code.
 */
const b = 2;

/**
 * @remarks This has a single-word body that should not get a semicolon added.
 */
const c = 3;

/**
 * @privateRemarks
 * Private notes about implementation.
 * Should also not be treated as code.
 */
function bar() {}

/**
 * @privateRemarks This is a private remark on one line.
 */
function baz() {}

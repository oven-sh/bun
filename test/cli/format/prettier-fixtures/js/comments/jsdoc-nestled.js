const issues = {
  see: "#7724 and #12653"
  /** Trailing comment 1 (not nestled as both comments should be multiline for that) *//**
  * Trailing comment 2
  */
};

/**
 * @template T
 * @param {Type} type
 * @param {T} value
 * @return {Value}
 *//**
 * @param {Type} type
 * @return {Value}
 */
function value(type, value) {
  if (arguments.length === 2) {
    return new ConcreteValue(type, value);
  } else {
    return new Value(type);
  }
}

/** Trailing nestled comment 1
 *//** Trailing nestled comment 2
 *//** Trailing nestled comment 3
 */

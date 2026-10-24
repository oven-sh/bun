const constant = "in a literal";
const inner = "two levels down";
const nested = { inner };
const Klass = class { value() { return helper; } };
const helper = "read by a method";
const unused = { nested };
module.exports = { constant, nested, Klass };

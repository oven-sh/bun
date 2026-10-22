class Kind {}
function look(value) { return [Object.keys(value).join(), "version" in value, value.version].join("|"); }
const before = look(Kind);
module.exports = Kind;
module.exports.version = 4;
module.exports.log = before + " " + look(Kind);

function fromCommonJS() { return "from CommonJS"; }
function addedByName() { return "added by name"; }
exports.fromCommonJS = fromCommonJS;
for (const [name, value] of [["addedByName", addedByName]]) exports[name] = value;

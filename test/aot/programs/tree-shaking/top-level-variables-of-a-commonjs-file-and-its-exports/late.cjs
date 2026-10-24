module.exports = { read: () => below, get later() { return alsoBelow; } };
const below = "declared below the export";
const alsoBelow = "read by a getter";
const unused = below + alsoBelow;

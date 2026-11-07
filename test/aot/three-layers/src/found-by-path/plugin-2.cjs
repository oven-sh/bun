globalThis.loadsOfPlugin2 = (globalThis.loadsOfPlugin2 ?? 0) + 1;
let calls = 0;
exports.readByNobodyHere = "a name on exports that no file reads";
exports.call = () => ++calls;
exports.about = () => [typeof module, typeof require, __filename.split(/[\\/]/).slice(-2).join("/")];

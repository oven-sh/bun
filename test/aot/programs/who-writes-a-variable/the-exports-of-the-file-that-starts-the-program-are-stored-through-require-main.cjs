// The file that starts the program stores into its own exports and replaces them through require.main and process.mainModule.
const out = [];
out.push(require.main === module, require.main.exports === exports); require.main.exports.viaMain = 7; out.push(exports.viaMain, module.exports.viaMain);
process.mainModule.exports = { swapped: 8 }; out.push(module.exports.swapped, exports.swapped);
exports = { local: 1 }; out.push(module.exports.local, require.main.exports.swapped);
console.log(JSON.stringify(out));

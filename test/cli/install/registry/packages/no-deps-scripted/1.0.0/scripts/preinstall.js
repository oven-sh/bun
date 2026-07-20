const fs = require(`fs`);

console.log(`preinstall out`);
console.error(`preinstall err`);

fs.appendFileSync(`${__dirname}/../log.js`, `module.exports.push('preinstall');`);

const fs = require(`fs`);

console.log(`install out`);
console.error(`install err`);

fs.appendFileSync(`${__dirname}/../log.js`, `module.exports.push('install');`);

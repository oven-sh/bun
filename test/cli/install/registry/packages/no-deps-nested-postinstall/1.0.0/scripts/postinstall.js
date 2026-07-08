const fs = require(`fs`);

fs.appendFileSync(`${__dirname}/../log.js`, `/*${fs.appendFileSync.toString()}*/ module.exports.push('postinstall');`);

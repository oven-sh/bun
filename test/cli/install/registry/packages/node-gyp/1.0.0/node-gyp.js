const fs = require('fs');
const path = require('path');

fs.writeFileSync('build.node', `${process.cwd()}${path.sep}build.node`);

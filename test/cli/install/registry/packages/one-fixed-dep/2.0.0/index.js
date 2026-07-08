module.exports = require(`./package.json`);

for (const key of [`dependencies`, `devDependencies`, `peerDependencies`]) {
  for (const dep of Object.keys(module.exports[key] || {})) {
    module.exports[key][dep] = require(dep);
  }
}

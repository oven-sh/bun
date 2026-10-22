// `module.exports = fastify; module.exports.fastify = fastify; module.exports.default = fastify`: the function is its own member, twice, for importers of every kind. One member is stored through the function's own name, ahead of the export.
const fastify = require("./fastify.cjs");
const { fastify: named, default: byDefault } = require("./fastify.cjs");
console.log(fastify === named, named === byDefault, fastify.fastify.default.fastify === fastify, fastify({ a: 1 }).version, Object.keys(fastify).join());

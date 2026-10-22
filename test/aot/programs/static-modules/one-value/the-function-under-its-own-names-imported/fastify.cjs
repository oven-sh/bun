"use strict";
function fastify(options) {
  return { options, version: fastify.version };
}
fastify.version = "5";
module.exports = fastify;
module.exports.fastify = fastify;
module.exports.default = fastify;

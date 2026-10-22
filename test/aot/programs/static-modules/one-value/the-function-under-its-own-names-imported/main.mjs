// The same module imported by an ES module: by default, by name, and by a name that is stored through the function's own name.
import fastify, { fastify as named, version } from "./fastify.cjs";
import * as namespace from "./fastify.cjs";
console.log(fastify === named, namespace.default === fastify, version, typeof namespace.fastify);

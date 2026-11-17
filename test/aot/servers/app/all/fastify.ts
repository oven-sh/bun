// Every server of this folder that is written on Fastify, in one process, one after the other. Each prints the port it listens on.
import "./array-kind.ts";

await import("../fastify.ts");
await import("../fastify-schemas.ts");
await import("../api-fastify.ts");
await import("../features/fastify.ts");

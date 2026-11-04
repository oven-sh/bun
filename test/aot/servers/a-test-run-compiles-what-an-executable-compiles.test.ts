import { holdBothWays } from "./both-ways";

// The server on Fastify takes as long as these two and a half again: ../fuzz/grids/both-ways-fastify.ts.
holdBothWays({ hono: 98, express: 95 }, { hono: 92, express: 77 });

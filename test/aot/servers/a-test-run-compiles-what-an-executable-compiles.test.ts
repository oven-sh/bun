import { holdBothWays } from "./both-ways";

// The server on Fastify takes as long as these two and a half again: ../fuzz/grids/both-ways-fastify.ts.
holdBothWays(
  { hono: 98, express: 95 },
  { hono: 92, express: 77 },
  { equal: { hono: 92, express: 76 }, equalBehindAnotherFile: { express: 76 } },
  {
    equal: { express: 74 },
    equalBehindAnotherFile: { express: 74 },
    why: "the executable sees every caller of object-inspect and leaves nine of its functions out; a test run keeps them",
  },
);

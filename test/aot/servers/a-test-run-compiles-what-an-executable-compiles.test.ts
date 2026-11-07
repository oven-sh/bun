import { holdBothWays } from "./both-ways";

// The server on Fastify takes as long as these two and a half again: ../fuzz/grids/both-ways-fastify.ts.
holdBothWays(
  { hono: 98, express: 95 },
  { hono: 92, express: 77 },
  { equal: { hono: 92, express: 63 }, equalBehindAnotherFile: { express: 59 } },
  {
    equal: { express: 59 },
    why:
      "an entry by value that no compiled code enters is closed, and a test run knows the callers of fewer functions: " +
      "30 entries are closed in the executable where the one of the test run is open or is not there; " +
      "the rest is counting: 118 functions that were equal, the entries of files and bodies that only a closed entry named, are made no more",
  },
);

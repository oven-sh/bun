// Spawned by fetch-leak.test.ts ("fetch doesn't leak > fixture #1"). Fetches
// SERVER COUNT times without ever reading the bodies, which used to keep every
// Response reachable from the native side forever, then checks that the
// Responses were collected and prints one JSON line for the parent.
import { expectCollected, maxResponsesAlive } from "./fetch-leak-test-helpers.js";

const { SERVER } = process.env;
const COUNT = parseInt(process.env.COUNT, 10);
if (!SERVER || !Number.isSafeInteger(COUNT)) {
  throw new Error("SERVER and COUNT must be set: " + JSON.stringify({ SERVER, COUNT: process.env.COUNT }));
}

let requests = 0;
while (requests < COUNT) {
  const batch = [];
  for (let i = 0; i < Math.min(32, COUNT - requests); i++) batch.push(fetch(SERVER));
  for (const response of await Promise.all(batch)) {
    if (response.status !== 200) throw new Error(`unexpected status ${response.status}`);
    requests++;
  }
}

const { Response: responsesAlive } = await expectCollected(
  { Response: maxResponsesAlive },
  `${requests} fetches whose bodies were never read`,
);
console.log(JSON.stringify({ requests, responsesAlive }));

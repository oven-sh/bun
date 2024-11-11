import Fastify from "fastify";

let startOfLastRequest = performance.now();
const fastify = Fastify({});

// Declare a route
fastify.get("/", (request, reply) => {
  const now = performance.now();
  // if (startOfLastRequest && now - startOfLastRequest > 0.5) {
  // 	console.log("Elapsed", Math.trunc(now - startOfLastRequest), "ms");
  // }
  // startOfLastRequest = now;
  reply.send({ hello: "world" });
});

// Run the server!
fastify.listen({ port: 3000 }, (err, address) => {
  if (err) throw err;
  // Server is now listening on ${address}
});

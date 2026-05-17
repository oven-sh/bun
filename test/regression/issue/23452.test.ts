import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";

const fixturesDir = join(import.meta.dirname, "..", "fixtures");
const cert = readFileSync(join(fixturesDir, "cert.pem"), "utf8");
const key = readFileSync(join(fixturesDir, "cert.key"), "utf8");

test("HTTPS response has socket as own property with authorized=true", async () => {
  await using server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch() {
      return new Response("OK");
    },
  });

  const { response } = await new Promise<{ response: any }>((resolve, reject) => {
    const req = https.get(`https://localhost:${server.port}/`, { ca: cert, rejectUnauthorized: true }, res => {
      resolve({ response: res });
      res.resume();
    });
    req.on("error", reject);
  });

  // postman-request and similar libraries check hasOwnProperty('socket')
  expect(response.hasOwnProperty("socket")).toBe(true);
  expect(response.socket.encrypted).toBe(true);
  expect(response.socket.authorized).toBe(true);
});

test("HTTP response socket has no authorized property", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  const { socket } = await new Promise<{ socket: any }>((resolve, reject) => {
    const req = http.get(`http://localhost:${server.port}/`, res => {
      resolve({ socket: res.socket });
      res.resume();
    });
    req.on("error", reject);
  });

  expect(socket.encrypted).toBeUndefined();
  expect(socket.authorized).toBeUndefined();
});

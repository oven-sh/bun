#!/usr/bin/env bun
/**
 * Owns every `docker compose` invocation for a test shard.
 *
 * `docker compose up` is not safe to run concurrently for one project: two
 * invocations can race to create the same container, and the loser exits with
 * "Conflict. The container name ... is already in use". So instead of letting
 * each process shell out to compose (and retrying on conflicts), exactly one
 * process does: scripts/runner.node.mjs spawns this coordinator once per
 * shard, with the shard's test paths on argv and a unix socket path in
 * BUN_DOCKER_COORDINATOR_SOCKET. ensure() in test/docker/index.ts connects to
 * that socket, sends the service name, and waits for the ready message with
 * the port mapping; the in-flight map below collapses concurrent requests for
 * one service onto a single `compose up --wait`.
 *
 * This also subsumes the old warmup-ci.ts: the path→service map below
 * predicts which services argv's tests need and starts them at launch, so
 * they're healthy by the time the first test asks.
 *
 * Lifetime is tied to the runner: stdin is a pipe from it, and EOF means the
 * runner is gone.
 */

import { unlinkSync } from "node:fs";
import * as net from "node:net";
import { ensure, type ServiceInfo, type ServiceName } from "./index.ts";
import { prestartMap as prestartMapRaw } from "./prestart-map.mjs";

// Keys are paths relative to test/ — that's the shape runner.node.mjs passes
// (getTests() walks from testsPath, not repo root). Prefix-matched. The map
// literal lives in prestart-map.mjs (add new entries THERE) because
// scripts/runner.node.mjs — plain Node, which cannot import .ts — also reads
// it to schedule docker-backed test files last within the shard.
const prestartMap = prestartMapRaw as Record<string, readonly ServiceName[]>;

const socketPath = process.env.BUN_DOCKER_COORDINATOR_SOCKET;
if (!socketPath) {
  console.error("coordinator: BUN_DOCKER_COORDINATOR_SOCKET is not set");
  process.exit(1);
}

// This process IS the coordinator: its ensure() must run compose directly,
// never proxy to another coordinator whose socket leaked in through the
// environment.
delete process.env.BUN_DOCKER_COORDINATOR;

// Collapse concurrent requests for one service onto a single ensureServiceNow(),
// and remember the last ServiceInfo a successful ensure produced. The full
// ensure() path costs several serial `docker compose` spawns (build, ps -a,
// up --wait, port), so paying it once per requesting test file dominates the
// wall time of every container-backed test file in the shard. A settled result
// is still never trusted blindly: each new request re-validates the cached
// mapping with one TCP connect per published port and falls back to the full
// ensure() when any probe fails. That preserves the self-healing every test
// file's own ensure() provided before the coordinator existed — a container
// that died mid-run (host OOM kill, server crash) tears down its docker-proxy
// port bindings, so the probe fails and the next request restarts it — without
// handing out dead ports after a mid-run container crash.
const inflight = new Map<ServiceName, Promise<ServiceInfo>>();
const lastGood = new Map<ServiceName, ServiceInfo>();

// One TCP connect (bounded by `timeout` ms) to host:port. Resolves false on
// refusal, unreachable host, or timeout — never rejects.
function probePort(host: string, port: number, timeout = 2000): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}

async function isStillUp(info: ServiceInfo): Promise<boolean> {
  const results = await Promise.all(Object.values(info.ports).map(port => probePort(info.host, port)));
  return results.length > 0 && results.every(Boolean);
}

async function ensureServiceNow(service: ServiceName): Promise<ServiceInfo> {
  const cached = lastGood.get(service);
  if (cached !== undefined) {
    if (await isStillUp(cached)) {
      console.log(`coordinator: ${service} ready (cached)`);
      return cached;
    }
    // The container died (or its ports moved) since the last ensure: drop the
    // stale mapping and let the full ensure() restart it and re-read the ports.
    lastGood.delete(service);
    console.log(`coordinator: ${service} cached ports unreachable; re-ensuring`);
  }

  console.log(`coordinator: ensuring ${service}`);
  try {
    const info = await ensure(service);
    console.log(`coordinator: ${service} ready`);
    lastGood.set(service, info);
    return info;
  } catch (error) {
    console.error(`coordinator: ${service} failed: ${error}`);
    throw error;
  }
}

function ensureService(service: ServiceName): Promise<ServiceInfo> {
  let p = inflight.get(service);
  if (p === undefined) {
    p = ensureServiceNow(service);
    inflight.set(service, p);
    const evict = () => inflight.delete(service);
    p.then(evict, evict);
  }
  return p;
}

interface EnsureRequest {
  type: "ensure";
  service: ServiceName;
}

async function handle(request: EnsureRequest): Promise<{ ok: true; info: ServiceInfo } | { ok: false; error: string }> {
  if (request?.type !== "ensure" || typeof request.service !== "string" || !/^[a-z0-9_]+$/.test(request.service)) {
    return { ok: false, error: `invalid request: ${JSON.stringify(request)}` };
  }
  try {
    return { ok: true, info: await ensureService(request.service) };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

const server = net.createServer(socket => {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let request: EnsureRequest;
      try {
        request = JSON.parse(line);
      } catch {
        socket.write(JSON.stringify({ ok: false, error: `invalid request: ${line}` }) + "\n");
        continue;
      }
      void handle(request).then(reply => {
        if (!socket.destroyed) {
          socket.write(JSON.stringify(reply) + "\n");
        }
      });
    }
  });
  // The client vanishing mid-request is its problem, not ours.
  socket.on("error", () => {});
});

server.on("error", error => {
  console.error(`coordinator: failed to listen on ${socketPath}: ${error}`);
  process.exit(1);
});

server.listen(socketPath, () => {
  // The runner waits for this exact line before pointing tests at the socket.
  console.log(`COORDINATOR_READY ${socketPath}`);

  const prestart = new Set<ServiceName>();
  for (const arg of process.argv.slice(2)) {
    const testPath = arg.replaceAll("\\", "/");
    for (const [prefix, services] of Object.entries(prestartMap)) {
      if (testPath.startsWith(prefix)) {
        for (const service of services) prestart.add(service);
      }
    }
  }
  for (const service of prestart) {
    // Failures are logged by ensureService and reported again when a test
    // actually requests the service.
    void ensureService(service).catch(() => {});
  }
});

process.on("exit", () => {
  try {
    unlinkSync(socketPath);
  } catch {}
});

// Exit when the runner does: it holds our stdin pipe, so EOF means it's gone.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));

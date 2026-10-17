import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, canBuildNodeAddons, isWindows, tempDirWithFiles } from "harness";
import path from "node:path";

// On Windows (the libuv usockets backend), the socket-timeout sweep is a
// repeating 4s uv_timer. It must be armed only while sockets exist: once the
// last socket closes, us_internal_disable_sweep_timer stops it so an idle
// process blocks in the poll instead of waking every 4s forever, and a later
// socket must arm it again so socket.timeout() keeps firing.
//
// The fixture observes the real uv timer through a node-gyp addon using
// public embedder API (napi_get_uv_event_loop + uv_walk), identifying the
// sweep timer by its repeat interval (LIBUS_TIMEOUT_GRANULARITY = 4s; no
// other uv timer in Bun repeats at 4000ms).
const ADDON_C = /* c */ `
#include <node_api.h>
#include <uv.h>

#define NODE_API_CALL(env, call)                                               \\
  do {                                                                         \\
    if ((call) != napi_ok) {                                                   \\
      napi_throw_error((env), NULL, #call " failed");                          \\
      return NULL;                                                             \\
    }                                                                          \\
  } while (0)

typedef struct {
  napi_env env;
  napi_value arr;
  uint32_t idx;
  napi_status status;
  const char *failed_call;
} walk_state;

// uv_walk has no way to abort mid-walk, so record the first failure and make
// the remaining visits no-ops; Timers() turns it into a thrown error.
#define WALK_CALL(st, call)                                                    \\
  do {                                                                         \\
    if ((st)->status == napi_ok) {                                             \\
      (st)->status = (call);                                                   \\
      if ((st)->status != napi_ok) (st)->failed_call = #call " failed";        \\
    }                                                                          \\
  } while (0)

static void walk_cb(uv_handle_t *handle, void *arg) {
  walk_state *st = (walk_state *)arg;
  if (st->status != napi_ok) return;
  if (uv_handle_get_type(handle) != UV_TIMER) return;
  uv_timer_t *timer = (uv_timer_t *)handle;
  int active = uv_is_active(handle);
  napi_value obj, v;
  WALK_CALL(st, napi_create_object(st->env, &obj));
  WALK_CALL(st, napi_get_boolean(st->env, active != 0, &v));
  WALK_CALL(st, napi_set_named_property(st->env, obj, "active", v));
  WALK_CALL(st, napi_create_double(st->env, active ? (double)uv_timer_get_due_in(timer) : -1.0, &v));
  WALK_CALL(st, napi_set_named_property(st->env, obj, "dueIn", v));
  WALK_CALL(st, napi_create_double(st->env, (double)uv_timer_get_repeat(timer), &v));
  WALK_CALL(st, napi_set_named_property(st->env, obj, "repeat", v));
  WALK_CALL(st, napi_set_element(st->env, st->arr, st->idx, obj));
  st->idx++;
}

static napi_value Timers(napi_env env, napi_callback_info info) {
  uv_loop_t *loop = NULL;
  NODE_API_CALL(env, napi_get_uv_event_loop(env, &loop));
  if (loop == NULL) {
    napi_throw_error(env, NULL, "napi_get_uv_event_loop returned NULL");
    return NULL;
  }
  walk_state st = {env, NULL, 0, napi_ok, NULL};
  NODE_API_CALL(env, napi_create_array(env, &st.arr));
  uv_walk(loop, walk_cb, &st);
  if (st.status != napi_ok) {
    napi_throw_error(env, NULL, st.failed_call);
    return NULL;
  }
  return st.arr;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  NODE_API_CALL(env, napi_create_function(env, "timers", NAPI_AUTO_LENGTH, Timers, NULL, &fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "timers", fn));
  return exports;
}
`;

const FIXTURE_JS = /* js */ `
const addon = require("./build/Release/sweep_introspect.node");

// LIBUS_TIMEOUT_GRANULARITY * 1000
const SWEEP_REPEAT_MS = 4000;

function sweepTimers() {
  return addon.timers().filter(t => t.repeat === SWEEP_REPEAT_MS);
}

function dump(label) {
  console.error(label, JSON.stringify(addon.timers()));
}

async function pollUntil(cond, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await Bun.sleep(50);
  }
  return cond();
}

const noop = { data() {}, open() {}, close() {} };
const result = {};

dump("before any socket");
result.inactiveBeforeSockets = sweepTimers().every(t => !t.active);

const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: noop });
const sock = await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: noop });
dump("sockets open");
result.armedWhileSocketsOpen = sweepTimers().some(t => t.active);

sock.end();
server.stop(true);
result.stoppedAfterLastClose = await pollUntil(() => sweepTimers().every(t => !t.active), 10_000);
dump("after close");

const server2 = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: noop });
let sawTimeout = false;
const sock2 = await Bun.connect({
  hostname: "127.0.0.1",
  port: server2.port,
  socket: {
    ...noop,
    timeout() {
      sawTimeout = true;
    },
  },
});
result.rearmedForNewSocket = await pollUntil(() => sweepTimers().some(t => t.active), 10_000);
dump("reopened");

// Armed is not enough: disabling installs a noop callback, so prove the
// re-enabled timer dispatches to the real sweep by waiting for a socket
// timeout to fire (notify-only; one ~4s granularity tick).
sock2.timeout(1);
result.timeoutFiredAfterRearm = await pollUntil(() => sawTimeout, 30_000);

sock2.end();
server2.stop(true);
result.stoppedAfterSecondClose = await pollUntil(() => sweepTimers().every(t => !t.active), 10_000);
dump("after second close");

console.log(JSON.stringify(result));
`;

describe.if(isWindows && canBuildNodeAddons())("usockets sweep timer (libuv backend)", () => {
  let dir: string;

  beforeAll(() => {
    dir = tempDirWithFiles("uv-sweep-timer", {
      "addon.c": ADDON_C,
      "fixture.js": FIXTURE_JS,
      "binding.gyp": JSON.stringify({
        targets: [{ target_name: "sweep_introspect", sources: ["addon.c"] }],
      }),
      "package.json": JSON.stringify({
        name: "sweep-introspect",
        version: "1.0.0",
        // `bun --bun` like napi-app: under node >= 26, node-gyp inherits
        // clang=1 from the runner's process.config and generates vcxprojs
        // for the ClangCL toolset, which CI's VS install does not have.
        // Bun reports clang=0, selecting the stock MSVC toolset.
        scripts: { "build:napi": "bun --bun node-gyp rebuild" },
        dependencies: { "node-gyp": "^11.2.0" },
      }),
    });

    // --ignore-scripts skips the implicit `node-gyp rebuild` bun install runs
    // for a root binding.gyp package; build:napi below is the single build.
    for (const cmd of [
      [bunExe(), "install", "--ignore-scripts"],
      [bunExe(), "run", "build:napi"],
    ]) {
      const proc = spawnSync({ cmd, cwd: dir, env: bunEnv, stdout: "inherit", stderr: "inherit" });
      if (!proc.success) throw new Error(`${cmd.join(" ")} failed`);
    }
  }, 300_000);

  test("stops when the last socket closes and re-arms for new sockets", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(dir, "fixture.js")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect(JSON.parse(stdout)).toEqual({
      inactiveBeforeSockets: true,
      armedWhileSocketsOpen: true,
      stoppedAfterLastClose: true,
      rearmedForNewSocket: true,
      timeoutFiredAfterRearm: true,
      stoppedAfterSecondClose: true,
    });
    expect(exitCode).toBe(0);
  }, 90_000);
});

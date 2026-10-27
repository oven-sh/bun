// `new BroadcastChannel()` reads `new.target.prototype` for the prototype of the channel. The read can
// throw. It must throw before the constructor subscribes: the caller gets no channel to close.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("a new.target whose prototype cannot be read leaves no channel behind", async () => {
  // A channel holds the event loop until close() or unref(). A channel that outlives a constructor
  // that threw has no owner to call either, so the process below would never exit.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const accessor = function () {}.bind(null);
        Object.defineProperty(accessor, "prototype", {
          get() {
            throw new Error("prototype getter");
          },
        });
        const trap = new Proxy(function () {}, {
          get(target, key, receiver) {
            if (key === "prototype") throw new Error("prototype trap");
            return Reflect.get(target, key, receiver);
          },
        });
        const { proxy: revoked, revoke } = Proxy.revocable(function () {}, {});
        revoke();

        for (const [name, newTarget] of Object.entries({ accessor, trap, revoked })) {
          try {
            Reflect.construct(BroadcastChannel, ["unowned"], newTarget);
            console.log(name + ": did not throw");
          } catch (e) {
            console.log(name + ": " + (e instanceof TypeError ? "TypeError" : e.message));
          }
        }

        class Subclass extends BroadcastChannel {}
        const owned = new Subclass("owned");
        console.log("subclass: " + (Object.getPrototypeOf(owned) === Subclass.prototype));
        owned.close();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout: stdout.trim().split("\n"), exitCode }).toEqual({
    stdout: ["accessor: prototype getter", "trap: prototype trap", "revoked: TypeError", "subclass: true"],
    exitCode: 0,
  });
});

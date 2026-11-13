// One instance for the three files of 33-mock-made-in-trap-at-file-end-{a,b,c}.mjs
// in a `bun test` process.
import { mock } from "node:test";

// Once `state.armed` is set, each write to `proxied` that is not the write of
// the trap itself makes a mock of `proxied.run`. The end of a file writes to
// `proxied` to take a mock off, so each file end makes one more mock. The trap
// stops at `limit` mocks: a file end that takes each new mock off in turn then
// ends too, and the next file reads the count.
const limit = 100;
export const state = { armed: false, inTrap: false, made: 0 };
export const proxied = new Proxy(
  {
    run() {
      return "real";
    },
  },
  {
    defineProperty(target, key, descriptor) {
      const defined = Reflect.defineProperty(target, key, descriptor);
      if (state.armed && !state.inTrap && state.made < limit) {
        state.inTrap = true;
        try {
          const made = ++state.made;
          mock.method(proxied, "run", () => `made in trap ${made}`);
        } finally {
          state.inTrap = false;
        }
      }
      return defined;
    },
  },
);

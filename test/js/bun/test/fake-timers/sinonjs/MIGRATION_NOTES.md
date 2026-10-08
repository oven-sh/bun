# SinonJS Fake Timers Test Migration Notes

These tests come from @sinonjs/fake-timers. `helpers/setup-tests.ts` maps the part of its API they use onto `vi`.
This document lists the tests that do not run as written, and why.

## `it.failing`: the API has no counterpart in `vi`

| File                 | Test                                                                                                        | Uses                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `issue-59.test.ts`   | should install and uninstall the clock on a custom target                                                   | `FakeTimers.withGlobal()`                    |
| `issue-276.test.ts`  | should throw on using `config.target`                                                                       | `FakeTimers.install({ target })`             |
| `issue-516.test.ts`  | should successfully install the timer                                                                       | `FakeTimers.createClock()`                   |
| `issue-2449.test.ts` | should not fake faked timers                                                                                | `install()` throwing when it is called twice |
| `issue-2449.test.ts` | should not fake faked timers on a custom target                                                             | `FakeTimers.withGlobal()`                    |
| `issue-2449.test.ts` | should not allow a fake on a custom target if the global is faked and the context inherited from the global | `FakeTimers.withGlobal()`                    |
| `issue-2449.test.ts` | should allow a fake on the global if a fake on a customer target is already defined                         | `FakeTimers.withGlobal()`                    |

`vi.useFakeTimers()` fakes the one global object. Calling it again starts over with the new options, as in Vitest and Jest.

## `describe.todo`: `fake-timers.test.ts`

The main suite of @sinonjs/fake-timers creates standalone clocks with `FakeTimers.createClock()`, often several at once, and
asserts with `@sinonjs/referee-sinon`. Neither is available here.

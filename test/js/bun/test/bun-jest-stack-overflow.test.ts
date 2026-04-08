import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: Bun.jest() uses a lazy initializer that calls toObject() on
// an empty JSValue if createTestModule throws (e.g. from a stack overflow
// during its internal put() calls). The empty JSValue tripped
// ASSERT(isUndefinedOrNull()) in JSC's toObjectSlowCase; returning nullptr
// then tripped RELEASE_ASSERT(value) in LazyProperty::set, crashing on any
// build.
test("Bun.jest() does not crash when lazy initializer fails under stack pressure", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // Classic Fuzzilli pattern: recursive `new this.constructor()` pushes
      // frames to the stack limit, the inner new throws, the catch fires,
      // then Bun.jest() is called at or near max depth so one of the many
      // put()/createBound() calls inside createTestModule throws.
      `function F0(){const v=this.constructor;try{new v()}catch(e){}Bun.jest()}
try{new F0()}catch(e){}
console.log("OK:"+(typeof Bun.jest()==="object"));`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK:true\n");
  expect(exitCode).toBe(0);
});

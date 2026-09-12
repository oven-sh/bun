import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A WebAssembly GC object is the one kind of object that plain JS can hold whose structure
// has no realm, so JSObject::globalObject() is null for it. addEventListener() accepts any
// object as a listener, which used to make the dispatch read that null realm.
//
// (module
//   (type $s (struct (field (mut i32))))
//   (func (export "mk") (result (ref null $s)) struct.new_default $s))
const makeWasmGCObject = `
const bytes = new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0, 1,10,2, 0x5f,1,0x7f,1, 0x60,0,1,0x63,0, 3,2,1,1, 7,6,1,2,0x6d,0x6b,0,0, 10,7,1,5,0,0xfb,1,0,0x0b]);
const listener = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk();
`;

// Each receiver reaches JSEventListener::handleEvent through its own cast of `this`.
const receivers = {
  "EventTarget#dispatchEvent": `
    const target = new EventTarget();
    target.addEventListener("a", listener);
    target.dispatchEvent(new Event("a"));`,
  "AbortController#abort": `
    const controller = new AbortController();
    controller.signal.addEventListener("abort", listener);
    controller.abort();`,
  "the global dispatchEvent": `
    addEventListener("a", listener);
    dispatchEvent(new Event("a"));`,
};

for (const [name, script] of Object.entries(receivers)) {
  test.concurrent(`${name} does not crash on a WebAssembly GC object listener`, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${makeWasmGCObject}${script}\nconsole.log("survived");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("survived\n");
    expect(stderr).toContain("'handleEvent' property of event listener should be callable");
    expect(exitCode).toBe(1);
  });
}

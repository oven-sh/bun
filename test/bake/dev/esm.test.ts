// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { devTest, minimalFramework, Step } from "../dev-server-harness";

devTest("live bindings with `var`", {
  framework: minimalFramework,
  files: {
    "state.ts": `
      export var value = 0;
      export function increment() {
        value++;
      }
    `,
    "routes/index.ts": `
      import { value, increment } from '../state';
      export default function(req, meta) {
        increment();
        return new Response('State: ' + value);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect("State: 1");
    await dev.fetch("/").expect("State: 2");
    await dev.fetch("/").expect("State: 3");
    await dev.patch("routes/index.ts", {
      find: "State",
      replace: "Value",
    });
    await dev.fetch("/").expect("Value: 4");
    await dev.fetch("/").expect("Value: 5");
    await dev.write(
      "state.ts",
      `
        export var value = 0;
        export function increment() {
          value--;
        }
      `,
    );
    await dev.fetch("/").expect("Value: -1");
    await dev.fetch("/").expect("Value: -2");
  },
});

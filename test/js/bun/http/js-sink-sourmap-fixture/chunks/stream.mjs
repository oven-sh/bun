import { e as eventHandler } from "../index.mjs";
import "fs";
import "path";
import "node:async_hooks";
import "node:fs";
import "node:url";

const stream = eventHandler(() => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("nitro"));
      controller.enqueue(encoder.encode("is"));
      controller.enqueue(encoder.encode("awesome"));
      controller.close();
    },
  });
  return stream;
});

export { stream as default };
//# sourceMappingURL=stream.mjs.map

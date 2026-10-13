import { describe, expect } from "bun:test";
import { itBundled } from "../expectBundled";

describe("css", () => {
  // The default browser targets include browsers that have no `dvh`, `cqw` or `lh` unit. Such a
  // browser discards a declaration that uses one, and keeps the declaration before it.
  itBundled("css/keeps-the-declaration-before-one-a-target-rejects", {
    files: {
      "/index.css": /* css */ `
        .a { flex-basis: 100vh; flex-basis: 100dvh }
        .b { gap: 16px; gap: 2cqw }
        .c { background-size: 100vw 100vh; background-size: 100dvw 100dvh }
        .d { background: red; background-size: 100dvw 100dvh }
        .e { flex: 1 1 auto; flex-basis: 100dvh }
        .f { gap: 16px 8px; row-gap: 1lh }
        .g { border: 2px solid red; border: 1cqw solid red }
        .h { transform: translateX(100vw); transform: translateX(100dvw) }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      expect(api.readFile("/out/index.css")).toEqualIgnoringWhitespace(`
        /* index.css */
        .a { flex-basis: 100vh; flex-basis: 100dvh; }
        .b { gap: 16px; gap: 2cqw; }
        .c { background-size: 100vw 100vh; background-size: 100dvw 100dvh; }
        .d { background: red; background-size: 100dvw 100dvh; }
        .e { flex: auto; flex-basis: 100dvh; }
        .f { gap: 16px 8px; row-gap: 1lh; }
        .g { border: 2px solid red; border: 1cqw solid red; }
        .h { transform: translateX(100vw); transform: translateX(100dvw); }
      `);
    },
  });
});

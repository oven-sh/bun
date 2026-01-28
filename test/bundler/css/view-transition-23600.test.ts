import { itBundled } from "../expectBundled";

describe("css", () => {
  itBundled("css/view-transition-class-selector-23600", {
    files: {
      "index.css": /* css */ `
        @keyframes slide-out {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(-100%);
          }
        }

        ::view-transition-old(.slide-out) {
          animation-name: slide-out;
          animation-timing-function: ease-in-out;
        }

        ::view-transition-new(.fade-in) {
          animation-name: fade-in;
        }

        ::view-transition-group(.card) {
          animation-duration: 1s;
        }

        ::view-transition-image-pair(.hero) {
          isolation: isolate;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        @keyframes slide-out {
          from {
            opacity: 1;
            transform: translateX(0);
          }

          to {
            opacity: 0;
            transform: translateX(-100%);
          }
        }

        ::view-transition-old(.slide-out) {
          animation-name: slide-out;
          animation-timing-function: ease-in-out;
        }

        ::view-transition-new(.fade-in) {
          animation-name: fade-in;
        }

        ::view-transition-group(.card) {
          animation-duration: 1s;
        }

        ::view-transition-image-pair(.hero) {
          isolation: isolate;
        }
        "
      `);
    },
  });
});

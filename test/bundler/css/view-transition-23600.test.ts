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

  // Outside CSS modules the view transition names are printed as written.
  itBundled("css/view-transition-declarations", {
    files: {
      "index.css": /* css */ `
        .card {
          view-transition-name: hero;
          view-transition-class: slide fade;
          view-transition-group: hero;
        }

        .page {
          view-transition-name: NONE;
          view-transition-class: none;
          view-transition-group: NEAREST;
        }

        .root {
          view-transition-name: match-element;
          view-transition-group: contain;
        }

        .invalid {
          view-transition-name: 1px;
          view-transition-class: slide none;
          view-transition-group: var(--group);
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        .card {
          view-transition-name: hero;
          view-transition-class: slide fade;
          view-transition-group: hero;
        }

        .page {
          view-transition-name: none;
          view-transition-class: none;
          view-transition-group: nearest;
        }

        .root {
          view-transition-name: match-element;
          view-transition-group: contain;
        }

        .invalid {
          view-transition-name: 1px;
          view-transition-class: slide none;
          view-transition-group: var(--group);
        }
        "
      `);
    },
  });
});

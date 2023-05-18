import assert from "assert";
import dedent from "dedent";
import { itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

describe("bundler", () => {
  // https://github.com/oven-sh/bun/issues/2946
  itBundled("regression/InvalidIdentifierInFileName#2946", {
    files: {
      "/entry.js": "import foo from './1.png';\nconsole.log(foo);",
      "/1.png": "abcdefgh",
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    run: {
      file: "/out/entry.js",
    },
  });

  itBundled("regression/MergeAdjacentDecl#2942", {
    files: {
      "/shared.js": `
      // Current version.
      export var VERSION = '1.13.6';
      
      // Establish the root object, \`window\` (\`self\`) in the browser, \`global\`
      // on the server, or \`this\` in some virtual machines. We use \`self\`
      // instead of \`window\` for \`WebWorker\` support.
      export var root = (typeof self == 'object' && self.self === self && self) ||
                (typeof global == 'object' && global.global === global && global) ||
                Function('return this')() ||
                {};
      
      // Save bytes in the minified (but not gzipped) version:
      export var ArrayProto = Array.prototype, ObjProto = Object.prototype;
      export var SymbolProto = typeof Symbol !== 'undefined' ? Symbol.prototype : null;
      
      // Create quick reference variables for speed access to core prototypes.
      export var push = ArrayProto.push,
          slice = ArrayProto.slice,
          toString = ObjProto.toString,
          hasOwnProperty = ObjProto.hasOwnProperty;
      
      // Modern feature detection.
      export var supportsArrayBuffer = typeof ArrayBuffer !== 'undefined',
          supportsDataView = typeof DataView !== 'undefined';
      
      // All **ECMAScript 5+** native function implementations that we hope to use
      // are declared here.
      export var nativeIsArray = Array.isArray,
          nativeKeys = Object.keys,
          nativeCreate = Object.create,
          nativeIsView = supportsArrayBuffer && ArrayBuffer.isView;
      
      // Create references to these builtin functions because we override them.
      export var _isNaN = isNaN,
          _isFinite = isFinite;
      
      // Keys in IE < 9 that won't be iterated by \`for key in ...\` and thus missed.
      export var hasEnumBug = !{toString: null}.propertyIsEnumerable('toString');
      export var nonEnumerableProps = ['valueOf', 'isPrototypeOf', 'toString',
        'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];
      
      // The largest integer that can be represented exactly.
      export var MAX_ARRAY_INDEX = Math.pow(2, 53) - 1;
      
      `,
      // This was a race condition, so we want to add a lot of files to maximize the chances of hitting it
      "/a.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/b.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/c.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/d.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/e.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/g.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/h.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/i.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/j.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/k.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/l.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/m.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/n.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_1.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/a_2.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_3.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/a_4.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_5.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_6.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_7.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_8.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_9.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_10.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_11.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_12.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/a_13.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_1.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/b_2.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_3.js": "import * as ABC from './shared.js';; console.log(ABC);",
      "/b_4.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_5.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_6.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_7.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_8.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_9.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_10.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_11.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_12.js": "import * as ABC from './shared.js'; console.log(ABC);",
      "/b_13.js": "import * as ABC from './shared.js'; console.log(ABC);",
    },
    minifySyntax: true,

    entryPoints: [
      "/a.js",
      "/b.js",
      "/c.js",
      "/d.js",
      "/e.js",
      "/g.js",
      "/h.js",
      "/i.js",
      "/j.js",
      "/k.js",
      "/l.js",
      "/m.js",
      "/n.js",
      "/a_1.js",
      "/a_2.js",
      "/a_3.js",
      "/a_4.js",
      "/a_5.js",
      "/a_6.js",
      "/a_7.js",
      "/a_8.js",
      "/a_9.js",
      "/a_10.js",
      "/a_11.js",
      "/a_12.js",
      "/a_13.js",
      "/b_1.js",
      "/b_2.js",
      "/b_3.js",
      "/b_4.js",
      "/b_5.js",
      "/b_6.js",
      "/b_7.js",
      "/b_8.js",
      "/b_9.js",
      "/b_10.js",
      "/b_11.js",
      "/b_12.js",
      "/b_13.js",
    ],
  });

  // https://github.com/oven-sh/bun/issues/2948
  itBundled("regression/ReassignLocal#2948", {
    files: {
      "/entry.js": `
      import { Buffer } from 'node:buffer';

      export function schemaEncode(data) {
        const filename_len = Buffer.byteLength(data.filename);
        const buf = Buffer.allocUnsafe(29 + filename_len);
        buf.writeUInt8(1);
        for (let i=0; i<3; i++) buf.writeUInt32LE(data.to[i], 1 + i * 4);
        buf.writeDoubleLE(data.random, 13);
        buf.writeUInt16LE(data.page, 21);
        let offset = 23;
        offset = buf.writeUInt16LE(filename_len, offset);
        offset += buf.write(data.filename, offset);
        buf.writeUInt32LE(data.from, offset);
        return buf;
      }

      schemaEncode({filename: "heyyyy", to: [1,2,3], page: 123, random: Math.random(), from: 158})
      `,
    },
    minifySyntax: true,
    target: "bun",
    run: {
      file: "/entry.js",
    },
  });
});

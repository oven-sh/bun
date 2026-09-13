#!/usr/bin/env bun
// Generates the stand-in packages that bun-patch.test.ts installs instead of the real npm
// packages of the same name and version. Each stand-in keeps the package.json fields that
// `bun patch` and the module resolver react to (main, type, types, exports, peerDependencies,
// dependencies) and ships only a few tiny files.

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Version = {
  version: string;
  manifest: Record<string, unknown>;
  files: Record<string, string>;
};

const isEvenIndex = `'use strict';

var isOdd = require('is-odd');

module.exports = function isEven(i) {
  if (typeof i !== 'number') {
    throw new TypeError('is-even expects a number.');
  }
  return !isOdd(i);
};
`;

const isOddLegacyIndex = `'use strict';

module.exports = function isOdd(i) {
  if (typeof i !== 'number') {
    throw new TypeError('is-odd expects a number.');
  }
  return !!(~~i & 1);
};
`;

const isOddIndex = `'use strict';

module.exports = function isOdd(value) {
  const n = Math.abs(value);
  if (!Number.isInteger(n)) {
    throw new TypeError('expected an integer');
  }
  return (n % 2) === 1;
};
`;

const reactIndex = `'use strict';

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react.production.min.js');
} else {
  module.exports = require('./cjs/react.development.js');
}
`;

const reactDevelopment = `'use strict';

exports.version = '18.3.1';
exports.createElement = function createElement(type, props) {
  return { type: type, props: props || {} };
};
`;

const reactProduction = `'use strict';exports.version="18.3.1";exports.createElement=function(t,p){return{type:t,props:p||{}}};
`;

const reactDomIndex = `'use strict';

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-dom.production.min.js');
} else {
  module.exports = require('./cjs/react-dom.development.js');
}
`;

const reactDomDevelopment = `'use strict';

var React = require('react');

exports.version = '18.3.1';
exports.render = function render(element) {
  return React.createElement(element.type, element.props);
};
`;

const reactDomProduction = `'use strict';var React=require("react");exports.version="18.3.1";exports.render=function(e){return React.createElement(e.type,e.props)};
`;

const axiosLib = `function Axios(config) {
  this.defaults = config || {};
}

const axios = new Axios();
axios.Axios = Axios;
axios.VERSION = '1.7.2';

export default axios;
`;

const axiosCjs = `'use strict';

function Axios(config) {
  this.defaults = config || {};
}

const axios = new Axios();
axios.Axios = Axios;
axios.VERSION = '1.7.2';

module.exports = axios;
`;

// DefinitelyTyped packages publish with an empty `main` and no JavaScript.
const typesOnly = (extra: Record<string, unknown> = {}) => ({ main: "", types: "index.d.ts", ...extra });

const wsTypes = `/// <reference types="node" />

declare class WebSocket {
  constructor(address: string);
  send(data: string): void;
}

export = WebSocket;
`;

const packages: Record<string, Version[]> = {
  "is-even": [
    {
      version: "1.0.0",
      manifest: { main: "index.js", dependencies: { "is-odd": "^0.1.2" } },
      files: { "index.js": isEvenIndex },
    },
  ],
  "is-odd": [
    { version: "0.1.2", manifest: { main: "index.js" }, files: { "index.js": isOddLegacyIndex } },
    { version: "3.0.1", manifest: { main: "index.js" }, files: { "index.js": isOddIndex } },
  ],
  // Like the real lodash, the entry point is not index.js and the package has a nested directory.
  "lodash": [
    {
      version: "4.17.21",
      manifest: { main: "lodash.js" },
      files: {
        "lodash.js": `module.exports = { VERSION: '4.17.21', chunk: require('./chunk.js') };\n`,
        "chunk.js": `module.exports = function chunk(array, size) {
  var result = [];
  for (var i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
};
`,
        "fp.js": `module.exports = require('./fp/_baseConvert.js')(require('./lodash.js'));\n`,
        "fp/_baseConvert.js": `var mapping = require('./_mapping.js');
module.exports = function baseConvert(lodash) {
  return { placeholder: require('./placeholder.js'), aliases: mapping.aliasToReal, chunk: lodash.chunk };
};
`,
        "fp/_mapping.js": `exports.aliasToReal = { each: 'forEach', extend: 'assignIn' };\n`,
        "fp/placeholder.js": `module.exports = {};\n`,
      },
    },
  ],
  "react": [
    {
      version: "18.3.1",
      manifest: {
        main: "index.js",
        exports: {
          ".": { "react-server": "./react.shared-subset.js", "default": "./index.js" },
          "./package.json": "./package.json",
        },
      },
      files: {
        "index.js": reactIndex,
        "react.shared-subset.js": `'use strict';\n\nmodule.exports = require('./cjs/react.development.js');\n`,
        "cjs/react.development.js": reactDevelopment,
        "cjs/react.production.min.js": reactProduction,
      },
    },
  ],
  "react-dom": [
    {
      version: "18.3.1",
      manifest: {
        main: "index.js",
        exports: {
          ".": "./index.js",
          "./client": "./client.js",
          "./package.json": "./package.json",
        },
        peerDependencies: { react: "^18.3.1" },
      },
      files: {
        "index.js": reactDomIndex,
        "client.js": `'use strict';\n\nvar m = require('./index.js');\n\nexports.createRoot = function createRoot(container) {\n  return { render: m.render, container: container };\n};\n`,
        "cjs/react-dom.development.js": reactDomDevelopment,
        "cjs/react-dom.production.min.js": reactDomProduction,
      },
    },
  ],
  "axios": [
    {
      version: "1.7.2",
      manifest: {
        type: "module",
        main: "index.js",
        types: "index.d.ts",
        exports: {
          ".": {
            types: { require: "./index.d.cts", default: "./index.d.ts" },
            browser: { require: "./dist/browser/axios.cjs", default: "./index.js" },
            default: { require: "./dist/node/axios.cjs", default: "./index.js" },
          },
          "./package.json": "./package.json",
        },
      },
      files: {
        "index.js": `import axios from './lib/axios.js';\n\nconst { Axios, VERSION } = axios;\n\nexport { axios as default, Axios, VERSION };\n`,
        "index.d.ts": `declare const axios: { defaults: object; VERSION: string };\nexport default axios;\n`,
        "index.d.cts": `declare const axios: { defaults: object; VERSION: string };\nexport = axios;\n`,
        "lib/axios.js": axiosLib,
        "dist/node/axios.cjs": axiosCjs,
        "dist/browser/axios.cjs": axiosCjs,
      },
    },
  ],
  "@types/ws": [
    { version: "7.4.7", manifest: typesOnly(), files: { "index.d.ts": wsTypes } },
    {
      version: "8.5.4",
      manifest: typesOnly({
        exports: {
          ".": { types: { import: "./index.d.mts", default: "./index.d.ts" } },
          "./package.json": "./package.json",
        },
      }),
      files: {
        "index.d.ts": wsTypes,
        "index.d.mts": `import WebSocket = require("./index.js");\nexport default WebSocket;\n`,
      },
    },
  ],
  "@types/express-serve-static-core": [
    {
      version: "4.17.43",
      manifest: typesOnly(),
      files: { "index.d.ts": `export interface Request {\n  url: string;\n}\n` },
    },
  ],
  "@types/uuencode": [
    {
      version: "0.0.3",
      manifest: typesOnly(),
      files: { "index.d.ts": `export function encode(data: string): string;\n` },
    },
  ],
};

for (const [name, versions] of Object.entries(packages)) {
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });
  // Scoped tarballs live at `<scope>/<name>/<name>-<version>.tgz`.
  const unscoped = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;

  const manifests: Record<string, object> = {};
  let latest = "";
  for (const { version, manifest, files } of versions) {
    const pkgJson = { name, version, ...manifest };
    const tarball = join(dir, `${unscoped}-${version}.tgz`);
    const entries: Record<string, string> = { "package/package.json": JSON.stringify(pkgJson, null, 2) + "\n" };
    for (const [path, contents] of Object.entries(files)) entries[`package/${path}`] = contents;
    await Bun.Archive.write(tarball, entries, { compress: "gzip" });

    const bytes = await Bun.file(tarball).bytes();
    manifests[version] = {
      ...pkgJson,
      _id: `${name}@${version}`,
      dist: {
        integrity: `sha512-${Buffer.from(new Bun.CryptoHasher("sha512").update(bytes).digest()).toString("base64")}`,
        shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
        tarball: `http://localhost:4873/${name}/-/${name}-${version}.tgz`,
      },
    };
    latest = version;
  }

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest }, versions: manifests }, null, 2) + "\n",
  );
}

console.log(`Created ${Object.keys(packages).join(", ")}`);

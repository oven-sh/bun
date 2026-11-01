// What Module.prototype._compile does with text that is not CommonJS, a row for each text.
// node-module-module.test.js runs this file under Bun and under Node.js, beside dep.mjs, sub/dep.mjs and commonjs.cjs.
const Module = require("node:module");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const isBun = !!process.versions.bun;
const here = (...names) => path.join(__dirname, ...names);
const relative = file => path.relative(__dirname, file).replaceAll("\\", "/");
// Each engine has its own words for a SyntaxError, so a message is a part of the row under Bun only.
const thrown = e =>
  e instanceof Error
    ? {
        threw: e.name,
        ...(e.code && { code: e.code }),
        ...(isBun && {
          message: String(e.message).split("\n")[0].replaceAll(__dirname, "<dir>").replaceAll("\\", "/"),
        }),
      }
    : { threwValue: e };
const attempt = fn => {
  try {
    return fn();
  } catch (e) {
    return thrown(e);
  }
};
const compile = (text, filename) => {
  const m = new Module(filename);
  const returned = m._compile(text, filename);
  return { exports: m.exports, returned, loaded: m.loaded };
};
const exportsOf = (text, filename) => compile(text, filename).exports;
const filenameOf = filename => relative(exportsOf("export const filename = import.meta.filename;", filename).filename);

const rows = {};

rows.namedAndDefault = attempt(() => {
  const { exports, returned, loaded } = compile("export const v = 1; export default 7;", here("virtual", "a.js"));
  return { exports: { ...exports }, esModule: exports.__esModule, returned: String(returned), loaded };
});
rows.moduleExportsExport = attempt(() =>
  exportsOf('const x = { custom: true }; export { x as "module.exports" };', here("virtual", "b.js")),
);
rows.importMetaOnly = attempt(() => {
  const exports = exportsOf("globalThis.seenURL = import.meta.url;", here("virtual", "c.js"));
  return { exports: { ...exports }, url: relative(fileURLToPath(globalThis.seenURL)) };
});
rows.redeclaresModuleAndRequire = attempt(() => {
  exportsOf("const module = 1; const require = 2; globalThis.redeclared = module + require;", here("virtual", "d.js"));
  return globalThis.redeclared;
});
rows.topLevelAwait = {
  ...attempt(() =>
    exportsOf(
      "globalThis.awaitingTextRan = true; await new Promise(() => {}); export const late = 1;",
      here("virtual", "e.js"),
    ),
  ),
  ran: globalThis.awaitingTextRan === true,
};
rows.importsFollowTheFilename = attempt(() => {
  const text =
    'import { dep } from "./dep.mjs"; import commonjs from "../commonjs.cjs"; export const out = [dep, commonjs.commonjs, import.meta.filename];';
  const [dep, commonjs, filename] = exportsOf(text, here("sub", "virtual.js")).out;
  return { dep, commonjs, filename: relative(filename) };
});
const dynamicImport = attempt(
  () => exportsOf('export const dep = import("./dep.mjs");', here("sub", "dynamic.js")).dep,
);
rows.relativeFilename = attempt(() => filenameOf("sub/relative.js"));
rows.unnormalizedFilename = attempt(() =>
  filenameOf(__dirname + path.sep + "sub" + path.sep + ".." + path.sep + "dots.js"),
);
const ofEmptyFilename = attempt(() => exportsOf("export const filename = import.meta.filename;", ""));
rows.emptyFilename = attempt(() => relative(ofEmptyFilename.filename));
// Node.js keeps a separator at the end of the filename in the name of the module. Bun's resolver reads the name of a
// module without it, so the module has the name without it.
rows.separatorAtTheEndOfTheFilename = attempt(() => {
  const text = "export const url = import.meta.url;";
  const withSeparator = exportsOf(text, "virtual/trailing/");
  return {
    url: withSeparator.url.endsWith("/virtual/trailing/"),
    ownModule: withSeparator !== exportsOf(text, "virtual/trailing"),
  };
});
// Only on Windows is a backslash a separator.
rows.backslashInTheFilename = attempt(() => {
  const text = "export const url = import.meta.url;";
  return { sameModule: exportsOf(text, "virtual/back\\slash.js") === exportsOf(text, "virtual/back/slash.js") };
});
rows.sameFilenameTwice = attempt(() => {
  const first = exportsOf("export const n = 1;", here("virtual", "twice.js"));
  const second = exportsOf("export const n = 2;", here("virtual", "twice.js"));
  return { first: first.n, second: second.n, same: first === second };
});
rows.typoUnderTheNameOfAnESModule = attempt(() => exportsOf("module.exports = {;", here("virtual", "twice.js")));
rows.exportSyntaxError = attempt(() => exportsOf("export const a = 1;\nconst a = 2;", here("virtual", "f.js")));
rows.importSyntaxError = attempt(() =>
  exportsOf('import { dep } from "./dep.mjs";\nlet dep;', here("virtual", "g.js")),
);
rows.importMetaSyntaxError = attempt(() => exportsOf("import.meta.url;\nlet a; let a;", here("virtual", "h.js")));
rows.validTextAfterSyntaxError = attempt(() => exportsOf("export const a = 3;", here("virtual", "f.js")).a);
// Text that does not load keeps the name with its error, as a file does, until the name is deleted from
// require.cache. Node.js lets go of the name of text with an import that is not found.
rows.textAfterAnImportIsNotFound = attempt(() => {
  const name = here("virtual", "nf.js");
  const codeOrN = fn => {
    try {
      return fn().n;
    } catch (e) {
      return e.code;
    }
  };
  const first = codeOrN(() => exportsOf('import "./no-such-file.mjs"; export const n = 1;', name));
  const second = codeOrN(() => exportsOf("export const n = 2;", name));
  delete require.cache[name];
  return { first, second, afterDelete: codeOrN(() => exportsOf("export const n = 2;", name)) };
});
rows.commonJSTypo = attempt(() => exportsOf("module.exports = {;", here("virtual", "i.js")));
// The message of the typo is the one that a static import gets as CommonJS.
const unclosedImportCall = 'if (globalThis.nope) return;\nconst p = import("node:fs";';
rows.unclosedImportCall = attempt(() => exportsOf(unclosedImportCall, here("virtual", "w.js")));
rows.unclosedImportCallUnderTheNameOfAnESModule = attempt(() =>
  exportsOf(unclosedImportCall, here("virtual", "twice.js")),
);
rows.commonJSStaysCommonJS = attempt(() => exportsOf("module.exports = typeof require;", here("virtual", "j.js")));
rows.bodyThrows = attempt(() => exportsOf('throw new TypeError("from the body");', here("virtual", "r.js")));
rows.bodyThrowsANumber = attempt(() => exportsOf("throw 1;", here("virtual", "x.js")));
rows.bodyThrowsAnObjectNamedSyntaxError = attempt(() =>
  exportsOf('throw { name: "SyntaxError", message: "not an error" };', here("virtual", "y.js")),
);
rows.bodyThrowsItsOwnParseError = attempt(() => {
  globalThis.bodyRuns = 0;
  const text = 'globalThis.bodyRuns++; new Function("export const a = 1");';
  return { thrown: attempt(() => exportsOf(text, here("virtual", "k.js"))), bodyRuns: globalThis.bodyRuns };
});
rows.hashbangCommonJS = attempt(() => exportsOf("#!/usr/bin/env node\nmodule.exports = 1;", here("virtual", "l.js")));
rows.hashbangESModule = attempt(() => ({
  ...exportsOf("#!/usr/bin/env node\nexport const hashbang = true;", here("virtual", "m.js")),
}));
rows.thrownByTheModule = attempt(() =>
  exportsOf('export const a = 1; throw new Error("boom");', here("virtual", "o.js")),
);
rows.typeofRequire = attempt(() => exportsOf("export const t = typeof require;", here("virtual", "p.js")).t);
// CommonJS text that declares one of the wrapper's names again only parses as an ES module. Both runtimes say so
// in the same words where it then reads a name that an ES module does not have.
const messageOf = fn => {
  try {
    fn();
    return "did not throw";
  } catch (e) {
    return e.name + ": " + String(e.message).split("\n")[0];
  }
};
const messageOfText = (text, name) => messageOf(() => exportsOf(text, here("virtual", name)));
rows.commonJSNamesInESModuleText = {
  exports: messageOfText('const __filename = "x"; exports.value = __filename;', "s.js"),
  require: messageOfText('const __dirname = "x"; require("node:fs");', "t.js"),
  module: messageOfText("export {}; module.exports = 1;", "n1.js"),
  __filename: messageOfText("export {}; __filename;", "n2.js"),
  __dirname: messageOfText("export {}; __dirname;", "n3.js"),
  // Only those five names, in the message of a ReferenceError.
  anotherName: messageOfText("export {}; nope;", "n4.js"),
  anotherError: messageOfText('export {}; throw new TypeError("module is not defined");', "n5.js"),
  noMessage: messageOfText("export {}; throw new ReferenceError();", "n6.js"),
  otherWords: messageOfText('export {}; throw new ReferenceError("module is not DEFINED");', "n11.js"),
  objectAsMessage: messageOfText(
    'export {}; const e = new ReferenceError("x"); e.message = { toString: () => "module is not defined" }; throw e;',
    "n12.js",
  ),
  nameOfItsOwn: messageOfText(
    'export {}; throw new (class ConfigError extends ReferenceError { name = "ConfigError"; })("module is not defined");',
    "n13.js",
  ),
  assignedMessage: messageOfText(
    'export {}; const e = new ReferenceError(); const name = [..."module"].join(""); e.message = name + " is not defined"; throw e;',
    "n7.js",
  ),
};
// The message is assigned to, so the property keeps its attributes.
const messageDescriptor = (text, name) => {
  try {
    exportsOf(text, here("virtual", name));
  } catch (e) {
    return Object.getOwnPropertyDescriptor(e, "message");
  }
};
rows.messageKeepsItsAttributes = {
  enumerable: messageDescriptor(
    'export {}; const e = new ReferenceError("exports is not defined"); Object.defineProperty(e, "message", { enumerable: true }); throw e;',
    "n8.js",
  ),
  notEnumerable: messageDescriptor("export {}; module;", "n14.js"),
};
rows.frozenErrorStaysFrozen = attempt(() => {
  try {
    exportsOf(
      'export {}; throw Object.freeze(new ReferenceError("require is not defined"));',
      here("virtual", "n9.js"),
    );
  } catch (e) {
    return { ...thrown(e), frozen: Object.isFrozen(e) };
  }
});
// With top-level await in the text, the message names the two and says how to repair each.
rows.commonJSNamesAndTopLevelAwait = Object.fromEntries(
  ["require", "module", "exports", "__filename", "__dirname"].map(name => [
    name,
    attempt(() => exportsOf(name + "; await 0;", here("virtual", "tla-" + name + ".js"))),
  ]),
);
// The code is assigned to as well: it takes the place of a code, and an error that takes no new property gets none.
rows.commonJSNamesAndTopLevelAwait.codeOfItsOwn = attempt(() =>
  exportsOf(
    'const e = new ReferenceError("require is not defined"); e.code = "MINE"; throw e; await 0;',
    here("virtual", "tla-code.js"),
  ),
);
rows.commonJSNamesAndTopLevelAwait.notExtensible = attempt(() =>
  exportsOf(
    'throw Object.preventExtensions(new ReferenceError("__dirname is not defined")); await 0;',
    here("virtual", "tla-not-extensible.js"),
  ),
);
rows.filenameOfTheCommonJSEntry = attempt(() => ({ ...exportsOf("export const a = 1;", __filename) }));
rows.filenameOfAnImportedCommonJSFile = attempt(() => ({ ...exportsOf("export const a = 1;", here("commonjs.cjs")) }));
// require() alone gives a CommonJS file to no loader of ES modules, so the text gets the name. import() of the name
// then gets the text, and require() keeps the exports of the file.
const requiredCommonJS = here("required.cjs");
rows.filenameOfARequiredCommonJSFile = attempt(() => {
  require(requiredCommonJS);
  return { ...exportsOf("export const text = true;", requiredCommonJS) };
});
// Text under the path of a CommonJS file that nothing loaded. Bun has one registry for require() and import(), so
// require() of the path gets the text. Node.js keeps its cache of CommonJS modules apart, and require() runs the file.
rows.requireAfterTheTextOfAnUnloadedCommonJSFile = attempt(() => {
  const name = here("unloaded.cjs");
  return { text: exportsOf('export const who = "text";', name).who, require: require(name).who };
});
// A "?" in the filename starts a query in Bun, as in every name of a module, so import() of the name gets the text.
// In Node.js the filename is the path of a file, "?" and all, and the same import() loads dep.mjs.
const withQuery = attempt(() =>
  exportsOf('export const dep = "text"; export const filename = import.meta.filename;', here("dep.mjs") + "?query"),
);
rows.queryInTheFilename = attempt(() => ({ dep: withQuery.dep, filename: relative(withQuery.filename) }));
const importWithTheQuery = attempt(
  () => exportsOf('export const dep = import("../dep.mjs?query");', here("sub", "imports-query.js")).dep,
);
// An import() of a file has started, and in the same tick the text comes under the name of the file.
const importInFlight = import("./in-flight.mjs");
const textUnderAnImportInFlight = attempt(() => exportsOf('export const who = "text";', here("in-flight.mjs")).who);
if (isBun) {
  // Node.js prints a line of its own loader to stderr for a value that is no error.
  rows.esModuleThrowsANumber = attempt(() => exportsOf("export {}; throw 1;", here("virtual", "n10.js")));
  // Node.js has a branch for the main module: it imports the file of the name and does not use the text.
  rows.mainModuleAsReceiver = attempt(() => {
    const main = require.main;
    const before = main.exports;
    try {
      main._compile("export const a = 1;", here("virtual", "v.js"));
      return { ...main.exports };
    } finally {
      main.exports = before;
    }
  });
}
// process.chdir() to the same directory keeps the name. In another directory the empty filename is another module.
rows.emptyFilenameAfterChdir = attempt(() => {
  const text = "export const filename = import.meta.filename;";
  const before = process.cwd();
  process.chdir(before);
  const sameModule = exportsOf(text, "") === ofEmptyFilename;
  try {
    process.chdir(here("sub"));
    return { sameModule, inAnotherDirectory: relative(exportsOf(text, "").filename) };
  } finally {
    process.chdir(before);
  }
});

// Node.js stops looking for ES modules for good once Module.wrap or Module.wrapper is assigned, so these rows are
// the last. Bun puts no text through a replaced Module.wrap, and so does not count it.
rows.wrapAssigned = attempt(() => {
  const wrap = Module.wrap;
  Module.wrap = text => wrap(text);
  try {
    return { ...exportsOf("export const a = 1;", here("virtual", "wrap.js")) };
  } finally {
    Module.wrap = wrap;
  }
});
const wrapper = Module.wrapper;
const [start, end] = [wrapper[0], wrapper[1]];
rows.wrapperReplaced = attempt(() => {
  wrapper[0] = start + "/* changed */";
  try {
    return exportsOf("export const a = 1;", here("virtual", "q.js"));
  } finally {
    wrapper[0] = start;
  }
});
rows.wrapperPutBackByTheBody = attempt(() => {
  globalThis.putWrapperBack = () => {
    wrapper[0] = start;
    wrapper[1] = end;
  };
  globalThis.wrappedRuns = 0;
  // Inside this block `const require` is a new name. Inside the default wrapper it declares a parameter again.
  wrapper[0] = start + "putWrapperBack(); {";
  wrapper[1] = "\n}" + end;
  const text = 'globalThis.wrappedRuns++; const require = null; new Function("export const a = 1");';
  return { thrown: attempt(() => exportsOf(text, here("virtual", "u.js"))), runs: globalThis.wrappedRuns };
});
rows.afterTheWrapperIsPutBack = attempt(() => ({ ...exportsOf("export const a = 1;", here("virtual", "z.js")) }));

Promise.all([dynamicImport, importWithTheQuery, import("./required.cjs"), importInFlight]).then(
  ([namespace, withTheQuery, afterTheText, inFlight]) => {
    rows.dynamicImportFollowsTheFilename = namespace.dep ?? namespace;
    rows.importWithTheQueryOfTheFilename = withTheQuery.dep ?? withTheQuery;
    rows.afterTheTextOfARequiredCommonJSFile = { import: { ...afterTheText }, require: require(requiredCommonJS) };
    rows.importInFlight = {
      compile: textUnderAnImportInFlight,
      import: inFlight.who,
      fileRan: globalThis.inFlightFileRan === true,
    };
    console.log(JSON.stringify(rows));
  },
);

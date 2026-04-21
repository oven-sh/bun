import { expect, test } from "bun:test";
import { WASI } from "node:wasi";

test("WASI.getImportObject exists", () => {
  const wasi = new WASI({
    version: "preview1",
  });
  expect(typeof wasi.getImportObject).toBe("function");
});

test("WASI.getImportObject returns correct object for preview1", () => {
  const wasi = new WASI({
    version: "preview1",
  });
  const imports = wasi.getImportObject() as any;
  expect(imports).toBeDefined();
  expect(imports.wasi_snapshot_preview1).toBeDefined();
  expect(typeof imports.wasi_snapshot_preview1.fd_write).toBe("function");
});

test("WASI.getImportObject returns correct object for unstable", () => {
  const wasi = new WASI({
    version: "unstable",
  });
  const imports = wasi.getImportObject() as any;
  expect(imports).toBeDefined();
  expect(imports.wasi_unstable).toBeDefined();
  expect(typeof imports.wasi_unstable.fd_write).toBe("function");
});

test("WASI constructor throws for invalid version", () => {
  expect(() => new WASI({ version: "invalid" as any })).toThrow();
});

test("WASI.getImportObject returns default object when version is omitted", () => {
  const wasi = new WASI();
  const imports = wasi.getImportObject() as any;
  expect(imports.wasi_snapshot_preview1).toBeDefined();
});

test("WASI.wasiImport exists", () => {
  const wasi = new WASI({ version: "preview1" });
  expect((wasi as any).wasiImport).toBeDefined();
  expect(typeof (wasi as any).wasiImport.fd_write).toBe("function");
});

test("WASI.initialize exists", () => {
  const wasi = new WASI({ version: "preview1" });
  expect(typeof wasi.initialize).toBe("function");
});
test("WASI instances are isolated from each other", () => {
  const fs1 = { fstatSync: () => ({ dev: 1 }) } as any;
  const fs2 = { fstatSync: () => ({ dev: 2 }) } as any;

  const wasi1 = new WASI({ bindings: { fs: fs1, path: require("node:path") } } as any);
  const wasi2 = new WASI({ bindings: { fs: fs2, path: require("node:path") } } as any);

  expect((wasi1 as any).fstatSync(0).dev).toBe(1);
  expect((wasi2 as any).fstatSync(0).dev).toBe(2);
  // Ensure wasi1 is NOT overwritten by wasi2
  expect((wasi1 as any).fstatSync(0).dev).toBe(1);
});

test("WASI.initialize throws if _start exists", () => {
  const wasi = new WASI({ version: "preview1" });
  const instance = {
    exports: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      _start: () => {},
    },
  };
  expect(() => wasi.initialize(instance as any)).toThrow("instance.exports._start exists");
});

test("WASI.start throws if _initialize exists", () => {
  const wasi = new WASI({ version: "preview1" });
  const instance = {
    exports: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      _initialize: () => {},
    },
  };
  expect(() => wasi.start(instance as any)).toThrow("instance.exports._initialize exists");
});

test("WASI.initialize calls _initialize", () => {
  let initialized = false;
  const wasi = new WASI({ version: "preview1" });
  const instance = {
    exports: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      _initialize: () => {
        initialized = true;
      },
    },
  };
  wasi.initialize(instance as any);
  expect(initialized).toBe(true);
});

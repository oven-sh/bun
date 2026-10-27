import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { algorithmsInNoKey, cryptoKeyCloneTable } from "../../js/web/workers/crypto-key-clone-table.ts";

// structuredClone(), postMessage(), bun:jsc serialize() and advanced IPC copy a CryptoKey through a record that
// SerializedScriptValue.cpp writes and reads. That file has its own tag for each algorithm and its own checks of
// the algorithms that a key class accepts, and nothing ties them to the algorithm registry. #19674 registered
// X25519 and the reader still accepted Ed25519 only: an X25519 key could be made, `structuredClone(key)` threw,
// and no test failed.
//
// test/js/web/workers/structured-clone.test.ts clones the keys of every row of cryptoKeyCloneTable, and checks that
// crypto.subtle makes no key with an algorithm of algorithmsInNoKey. This lint reads the registry and fails when a
// registered algorithm is in neither list.

const registryFile = "src/jsc/bindings/webcrypto/CryptoAlgorithmRegistryOpenSSL.cpp";
const tableFile = "test/js/web/workers/crypto-key-clone-table.ts";
const root = path.resolve(import.meta.dir, "..", "..", "..");

const read = (file: string) =>
  readFileSync(path.join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const registry = read(registryFile);
const webcrypto = path.dirname(registryFile);
const headers = readdirSync(path.join(root, webcrypto))
  .filter(file => file.endsWith(".h"))
  .map(file => read(path.join(webcrypto, file)))
  .join("\n");

// registerAlgorithm<Class>() registers the class under `Class::s_name`, the name that crypto.subtle takes and
// `key.algorithm.name` reports. A class definition starts at column 0 and ends at the next `};` at column 0.
const registered = Array.from(registry.matchAll(/\bregisterAlgorithm<(\w+)>\(\);/g), ([, className]) => {
  const body = new RegExp(`^class ${className}\\b[^;{]*\\{([\\s\\S]*?)^\\};`, "m").exec(headers)?.[1];
  return {
    className,
    name: body?.match(/\bs_name = "([^"]+)"_s;/)?.[1],
    identifier: body?.match(/\bs_identifier = CryptoAlgorithmIdentifier::(\w+);/)?.[1],
  };
});

// Every algorithm has an enumerator in CryptoAlgorithmIdentifier.
const identifiers = (/\benum class CryptoAlgorithmIdentifier\b[^{]*\{([^}]*)\}/.exec(headers)?.[1] ?? "")
  .split(",")
  .map(enumerator => enumerator.trim().split(/\s*=/)[0])
  .filter(identifier => identifier !== "" && identifier !== "None");

const inRows = new Set(cryptoKeyCloneTable.flatMap(([{ name, hash }]) => (hash === undefined ? [name] : [name, hash])));
const inNoKey = new Set(algorithmsInNoKey);

test("this lint reads the registration of every algorithm", () => {
  expect(registered.length).toBeGreaterThan(0);
  // A registration in another shape is an algorithm that this lint does not check.
  expect(registered).toHaveLength(registry.match(/\bregisterAlgorithm\w*/g)?.length ?? 0);
  expect(registered.filter(({ name, identifier }) => name === undefined || identifier === undefined)).toEqual([]);
  // So is a registration in another file. Its class has an enumerator that no registration above has.
  expect(registered.map(({ identifier }) => identifier).sort()).toEqual(identifiers.sort());
});

test(`${tableFile} has every registered algorithm`, () => {
  const missing = registered
    .filter(({ name }) => name !== undefined && !inRows.has(name) && !inNoKey.has(name))
    .map(
      ({ name, className }) =>
        `${name} (${className}): add a row to cryptoKeyCloneTable for a key that has it as its algorithm or as its hash. If no key can have it, add the name to algorithmsInNoKey`,
    );
  expect(missing).toEqual([]);
});

test(`${tableFile} has only registered algorithms, and none in both lists`, () => {
  const names = new Set(registered.map(({ name }) => name));
  const wrong = [
    ...[...inRows, ...inNoKey].filter(name => !names.has(name)).map(name => `${name} is not registered`),
    ...[...inRows].filter(name => inNoKey.has(name)).map(name => `${name} is in both lists`),
  ];
  expect(wrong).toEqual([]);
});

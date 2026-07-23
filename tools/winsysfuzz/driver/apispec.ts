// Derive the runtime's callable API surface from bun's own type declarations
// (packages/bun-types) - the machine-readable spec the program generator
// draws from. No hand-picked API list: every exported function of the Bun
// namespace and its member interfaces (Bun.file(...).*, Bun.spawn(...).*,
// server methods, ...) is extracted with its parameter names, declared type
// text, and optionality, per overload.
//
//   bun driver/apispec.ts [--types <packages/bun-types>] [--out api.gen.json]

import { readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import ts from "typescript";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const here = import.meta.dir;
const typesDir = resolve(flag("--types", join(here, "..", "..", "..", "packages", "bun-types")));
const outPath = resolve(flag("--out", join(here, "generated", "api.gen.json")));

export interface Param {
  name: string;
  type: string; // declared type text (union members, object shapes preserved as text)
  optional: boolean;
  rest: boolean;
}
export interface Callable {
  // How the generator reaches it: "Bun.file", "Bun.spawn", or a method on a
  // produced object kind ("BunFile.text", "Subprocess.kill", ...).
  path: string;
  container: string; // "Bun" or the interface name it's a method of
  name: string;
  params: Param[];
  returns: string; // declared return type text (object KIND the generator can pool)
  isMethod: boolean;
  doc?: string;
}

const files = readdirSync(typesDir)
  .filter(f => f.endsWith(".d.ts"))
  .map(f => join(typesDir, f));
// node: module surfaces from @types/node - where most Windows-specific code
// (libuv fs, spawn/pipes, net) actually lives. Each named export becomes a
// callable "<module>.<fn>" the generator reaches via require("<module>").
const NODE_MODULES = ["fs", "child_process", "net", "dgram", "dns", "zlib", "crypto", "worker_threads", "os", "readline", "tty", "http", "https", "http2", "stream", "path"];
const nodeTypesDir = join(here, "..", "node_modules", "@types", "node");
const nodeFiles: string[] = [];
try {
  for (const m of NODE_MODULES) {
    const f = join(nodeTypesDir, `${m.replace("/", "")}.d.ts`);
    if (readdirSync(nodeTypesDir).includes(`${m.replace("/", "")}.d.ts`)) nodeFiles.push(f);
  }
} catch {}
files.push(...nodeFiles);
if (nodeFiles.length) console.log(`  including ${nodeFiles.length} node module declaration file(s)`);
const program = ts.createProgram(files, { noResolve: false, target: ts.ScriptTarget.ESNext, lib: ["lib.esnext.d.ts"] });
const checker = program.getTypeChecker();
void checker;

const callables: Callable[] = [];
const seen = new Set<string>();
const txt = (n?: ts.Node) => (n ? n.getText() : "unknown");

function paramsOf(sig: ts.SignatureDeclarationBase): Param[] {
  return sig.parameters.map(p => ({
    name: txt(p.name),
    type: p.type ? txt(p.type).replace(/\s+/g, " ") : "any",
    optional: !!p.questionToken || !!p.initializer,
    rest: !!p.dotDotDotToken,
  }));
}
function record(c: Callable) {
  const key = `${c.path}(${c.params.map(p => p.type).join(",")})`;
  if (seen.has(key)) return;
  seen.add(key);
  callables.push(c);
}

// Interface/class member methods, keyed by the container's name so the
// generator can call them on pooled objects of that KIND.
function recordMembers(container: string, members: ts.NodeArray<ts.TypeElement> | ts.NodeArray<ts.ClassElement>) {
  for (const m of members) {
    if ((ts.isMethodSignature(m) || ts.isMethodDeclaration(m)) && m.name) {
      const name = txt(m.name);
      if (!/^[A-Za-z_$]/.test(name)) continue; // computed/symbol members
      record({
        path: `${container}.${name}`,
        container,
        name,
        params: paramsOf(m as ts.SignatureDeclarationBase),
        returns: (m as ts.SignatureDeclarationBase).type ? txt((m as ts.SignatureDeclarationBase).type) : "unknown",
        isMethod: true,
      });
    }
  }
}

for (const sf of program.getSourceFiles()) {
  const fname = sf.fileName.replace(/\\/g, "/");
  // node modules: exported functions inside `declare module "fs" { ... }`
  if (fname.includes("@types/node")) {
    const visitNode = (node: ts.Node) => {
      if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) {
        const modName = txt(node.name).replace(/^["']|["']$/g, "").replace(/^node:/, "");
        if (NODE_MODULES.includes(modName)) {
          for (const st of node.body.statements) {
            if (ts.isFunctionDeclaration(st) && st.name && st.body === undefined) {
              const name = txt(st.name);
              if (/^_|Promises$/.test(name)) continue;
              record({
                path: `${modName.replace("/", "_")}.${name}`,
                container: `node:${modName}`,
                name,
                params: paramsOf(st),
                returns: st.type ? txt(st.type) : "unknown",
                isMethod: false,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visitNode);
    };
    ts.forEachChild(sf, visitNode);
    continue;
  }
  if (!fname.includes("packages/bun-types")) continue;
  const visit = (node: ts.Node) => {
    // `declare module "bun" { ... }` and `declare namespace Bun { ... }`
    if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) {
      const modName = txt(node.name).replace(/^["']|["']$/g, "");
      const inBun = modName === "bun" || modName === "Bun";
      for (const st of node.body.statements) {
        if (inBun && ts.isFunctionDeclaration(st) && st.name) {
          const name = txt(st.name);
          record({
            path: `Bun.${name}`,
            container: "Bun",
            name,
            params: paramsOf(st),
            returns: st.type ? txt(st.type) : "unknown",
            isMethod: false,
          });
        } else if (ts.isInterfaceDeclaration(st)) {
          recordMembers(txt(st.name), st.members);
        } else if (ts.isClassDeclaration(st) && st.name) {
          recordMembers(txt(st.name), st.members);
        } else if (ts.isModuleDeclaration(st)) {
          visit(st); // nested namespaces
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

// Group by container so the generator knows which methods each object KIND has.
const byContainer: Record<string, number> = {};
for (const c of callables) byContainer[c.container] = (byContainer[c.container] ?? 0) + 1;

await Bun.write(outPath, JSON.stringify({ generatedFrom: basename(typesDir), count: callables.length, callables }, null, 1));
console.log(`apispec: ${callables.length} callable(s) from ${files.length} declaration file(s) -> ${outPath}`);
console.log(
  `  Bun.* functions: ${byContainer["Bun"] ?? 0}; object kinds with methods: ${
    Object.keys(byContainer).length - 1
  } (top: ${Object.entries(byContainer)
    .filter(([k]) => k !== "Bun")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")})`,
);

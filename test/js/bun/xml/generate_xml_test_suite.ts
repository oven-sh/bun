#!/usr/bin/env bun
/**
 * Generates xml-test-suite.test.ts from the W3C XML Conformance Test Suite
 * (xmlts20130923, https://www.w3.org/XML/Test/).
 *
 * Usage:
 *   bun bd test/js/bun/xml/generate_xml_test_suite.ts [path-to-xmlconf-dir] [--check]
 *
 * Must run under the debug build (`bun bd`): rejection-test error messages, and
 * the behaviour pinned for cases whose verdict depends on reading external
 * entities, are captured from the in-tree Bun.XML at generation time. Without
 * an in-tree Bun.XML those assertions are omitted / emitted as test.todo.
 *
 * If no path is given, downloads the pinned archive from w3.org into a temp
 * directory (checked against ARCHIVE_SHA256) and extracts it with `tar`.
 * --check regenerates beside the committed suite and exits 1 if it differs.
 *
 * Scope: every catalogued case that applies to an XML 1.0 (Fifth Edition)
 * processor — cases for XML 1.1 / Namespaces 1.1, and cases restricted to
 * editions 1-4 (EDITION="1 2 3 4", superseded by Fifth Edition erratum E09),
 * are skipped. The six 180-313 KB `japanese/pr-xml-*` samples are skipped too:
 * they are ENTITIES="parameter" (advisory for a processor that does not read
 * external entities) and the same six encodings are covered by the 2-3 KB
 * `japanese/weekly-*` documents.
 *
 * How a case is asserted (Bun.XML is a non-validating processor that never
 * reads external entities — XML 1.0 §5.1):
 *   - TYPE="not-wf", ENTITIES="none": XML.parse throws SyntaxError (exact
 *     message asserted when captured at generation time).
 *   - TYPE="valid" | "invalid", ENTITIES="none": XML.parse accepts in both
 *     shapes (non-validating processors accept invalid-but-well-formed
 *     documents). When the catalogue gives a canonical OUTPUT file, the node
 *     tree ({ compact: false }) must serialize to it exactly (Second Canonical
 *     Form minus the DOCTYPE/notation block and processing instructions
 *     outside the root element, which Bun.XML does not represent), the
 *     compact object must equal the
 *     projection of that output, and stringify() of either shape must parse
 *     back to the same result.
 *   - ENTITIES != "none", TYPE="error", and the Namespaces-1.0 collection
 *     (Bun.XML treats names as opaque strings and does not enforce namespace
 *     constraints): the verdict legitimately depends on processor class, so the
 *     in-tree behaviour is pinned at generation time with the upstream verdict
 *     noted in a comment.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 1. Locate the suite
// ---------------------------------------------------------------------------
const ARCHIVE_URL = "https://www.w3.org/XML/Test/xmlts20130923.tar.gz";
const ARCHIVE_SHA256 = "9b61db9f5dbffa545f4b8d78422167083a8568c59bd1129f94138f936cf6fc1f";

const checkMode = process.argv.includes("--check");
let suiteDir = process.argv.slice(2).find(a => a !== "--check");
if (!suiteDir) {
  const tmp = mkdtempSync(join(tmpdir(), "xmlconf-"));
  const archive = join(tmp, "xmlts20130923.tar.gz");
  console.log(`Downloading ${ARCHIVE_URL} into ${tmp} ...`);
  execFileSync("curl", ["-fsSL", "-o", archive, ARCHIVE_URL], { stdio: "inherit" });
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (digest !== ARCHIVE_SHA256) {
    console.error(`SHA-256 mismatch for ${archive}: got ${digest}, expected ${ARCHIVE_SHA256}`);
    process.exit(1);
  }
  execFileSync("tar", ["-xzf", archive, "-C", tmp], { stdio: "inherit" });
  suiteDir = join(tmp, "xmlconf");
}
if (!existsSync(join(suiteDir, "xmlconf.xml"))) {
  console.error(`${suiteDir} does not look like an extracted xmlconf directory (no xmlconf.xml)`);
  process.exit(1);
}

const XML = (Bun as unknown as { XML?: { parse: Function; stringify: Function } }).XML;
if (!XML) {
  console.warn(
    "Bun.XML is not available in this build: error messages will not be asserted and advisory cases become test.todo.",
  );
}

// ---------------------------------------------------------------------------
// 2. Read the catalogue
// ---------------------------------------------------------------------------
// xmlconf.xml stitches the per-collection catalogues together with external
// entities; each collection's TESTCASES element carries the xml:base its URIs
// resolve against. Listed in xmlconf.xml order.
const COLLECTIONS: { describe: string; catalog: string; base: string }[] = [
  { describe: "xmltest", catalog: "xmltest/xmltest.xml", base: "xmltest/" },
  { describe: "japanese", catalog: "japanese/japanese.xml", base: "japanese/" },
  { describe: "sun", catalog: "sun/sun-valid.xml", base: "sun/" },
  { describe: "sun", catalog: "sun/sun-invalid.xml", base: "sun/" },
  { describe: "sun", catalog: "sun/sun-not-wf.xml", base: "sun/" },
  { describe: "sun", catalog: "sun/sun-error.xml", base: "sun/" },
  { describe: "oasis", catalog: "oasis/oasis.xml", base: "oasis/" },
  { describe: "ibm", catalog: "ibm/ibm_oasis_invalid.xml", base: "ibm/" },
  { describe: "ibm", catalog: "ibm/ibm_oasis_not-wf.xml", base: "ibm/" },
  { describe: "ibm", catalog: "ibm/ibm_oasis_valid.xml", base: "ibm/" },
  { describe: "eduni/errata-2e", catalog: "eduni/errata-2e/errata2e.xml", base: "eduni/errata-2e/" },
  { describe: "eduni/errata-3e", catalog: "eduni/errata-3e/errata3e.xml", base: "eduni/errata-3e/" },
  { describe: "eduni/errata-4e", catalog: "eduni/errata-4e/errata4e.xml", base: "eduni/errata-4e/" },
  { describe: "eduni/namespaces-1.0", catalog: "eduni/namespaces/1.0/rmt-ns10.xml", base: "eduni/namespaces/1.0/" },
  {
    describe: "eduni/namespaces-1.0",
    catalog: "eduni/namespaces/errata-1e/errata1e.xml",
    base: "eduni/namespaces/errata-1e/",
  },
  { describe: "eduni/misc", catalog: "eduni/misc/ht-bh.xml", base: "eduni/misc/" },
  // Not listed: ibm/xml-1.1/*, eduni/xml-1.1/xml11.xml, eduni/namespaces/1.1 —
  // XML 1.1 / Namespaces 1.1 only.
];

interface Case {
  collection: string;
  id: string;
  type: "valid" | "invalid" | "not-wf" | "error";
  entities: "none" | "general" | "parameter" | "both";
  sections: string;
  description: string;
  recommendation: string;
  namespace: boolean;
  input: Buffer;
  /** Expected Second Canonical Form, when the catalogue provides one. */
  output: string | undefined;
}

const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const cases: Case[] = [];
let skipped11 = 0,
  skippedEdition = 0,
  skippedBig = 0;
for (const { describe, catalog, base } of COLLECTIONS) {
  // The catalogues are ASCII/Latin-1; latin1 keeps byte offsets stable.
  const src = readFileSync(join(suiteDir, catalog), "latin1");
  for (const m of src.matchAll(/<TEST\b([^>]*)>([\s\S]*?)<\/TEST>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(attrRe)) attrs[a[1]] = a[2] ?? a[3];
    const recommendation = attrs.RECOMMENDATION ?? "XML1.0";
    if (recommendation === "XML1.1" || recommendation === "NS1.1" || attrs.VERSION === "1.1") {
      skipped11++;
      continue;
    }
    if (attrs.EDITION !== undefined && !attrs.EDITION.split(/\s+/).includes("5")) {
      skippedEdition++;
      continue;
    }
    if (base === "japanese/" && /^pr-xml-/.test(attrs.ID)) {
      skippedBig++;
      continue;
    }
    const input = readFileSync(join(suiteDir, base, attrs.URI));
    let output: string | undefined;
    if (attrs.OUTPUT)
      output = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(suiteDir, base, attrs.OUTPUT)));
    cases.push({
      collection: describe,
      id: attrs.ID,
      type: attrs.TYPE as Case["type"],
      entities: (attrs.ENTITIES ?? "none") as Case["entities"],
      sections: attrs.SECTIONS,
      description: m[2]
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim(),
      recommendation,
      namespace: attrs.NAMESPACE !== "no",
      input,
      output,
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Expected values: read Second Canonical Form, project to both shapes
// ---------------------------------------------------------------------------
// The OUTPUT files use "Second Canonical Form" (sun/cxml.html in the suite):
// James Clark's Canonical XML — UTF-8, no XML declaration, attributes sorted,
// &amp; &lt; &gt; &quot; &#9; &#10; &#13; as the only references, empty
// elements as start/end pairs, no comments, PIs kept — optionally preceded by
// a DOCTYPE listing notations. That grammar is small enough to read exactly.
type XPI = { target: string; data: string };
type XComment = { comment: string };
type XNode = { name: string; attributes: Record<string, string>; children: (XNode | XPI | XComment | string)[] };

function readCanonical(src: string, id: string): XNode {
  let i = 0;
  const fail = (msg: string) => new Error(`${id}: cannot read canonical output: ${msg} at ${i}`);
  const unescape = (s: string) =>
    s.replace(/&(amp|lt|gt|quot|apos|#([0-9]+));/g, (_, name, dec) =>
      dec ? String.fromCodePoint(Number(dec)) : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name as "amp"],
    );
  const skipPI = () => {
    const end = src.indexOf("?>", i);
    if (end < 0) throw fail("unterminated PI");
    i = end + 2;
  };
  // Canonical form writes `<?target data?>` with exactly one space.
  const readPI = (): XPI => {
    const end = src.indexOf("?>", i);
    if (end < 0) throw fail("unterminated PI");
    const body = src.slice(i + 2, end);
    i = end + 2;
    const sp = body.indexOf(" ");
    return sp < 0 ? { target: body, data: "" } : { target: body.slice(0, sp), data: body.slice(sp + 1) };
  };
  const readElement = (): XNode => {
    const m = /^<([^\s>/]+)((?: [^\s=]+="[^"]*")*)>/.exec(src.slice(i));
    if (!m) throw fail("bad start tag");
    i += m[0].length;
    const node: XNode = { name: m[1], attributes: {}, children: [] };
    for (const a of m[2].matchAll(/ ([^\s=]+)="([^"]*)"/g)) node.attributes[a[1]] = unescape(a[2]);
    let text = "";
    const flush = () => {
      if (!text) return;
      node.children.push(unescape(text));
      text = "";
    };
    while (i < src.length) {
      if (src.startsWith("</", i)) {
        flush();
        const end = src.indexOf(">", i);
        if (src.slice(i + 2, end) !== node.name) throw fail("mismatched end tag");
        i = end + 1;
        return node;
      } else if (src.startsWith("<?", i)) {
        flush();
        node.children.push(readPI());
      } else if (src[i] === "<") {
        flush();
        node.children.push(readElement());
      } else {
        text += src[i++];
      }
    }
    throw fail("end of file inside element");
  };
  let root: XNode | undefined;
  while (i < src.length) {
    if (src.startsWith("<?", i)) skipPI();
    else if (root === undefined && src.startsWith("<!DOCTYPE ", i)) {
      const end = src.indexOf("]>\n", i);
      if (end < 0) throw fail("unterminated DOCTYPE");
      i = end + 3;
    } else if (root === undefined && src[i] === "<") root = readElement();
    else throw fail("unexpected content at top level");
  }
  if (!root) throw fail("no root element");
  return root;
}

const CANON_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};
function codePointCompare(a: string, b: string): number {
  const x = [...a],
    y = [...b];
  for (let k = 0; k < x.length && k < y.length; k++) {
    const d = x[k].codePointAt(0)! - y[k].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
function writeCanonical(node: XNode | XPI | XComment | string): string {
  if (typeof node === "string") return node.replace(/[&<>"\t\n\r]/g, c => CANON_ESCAPES[c]);
  if ("comment" in node) return "";
  if ("target" in node) return `<?${node.target} ${node.data}?>`;
  const attrs = Object.keys(node.attributes)
    .sort(codePointCompare)
    .map(k => ` ${k}="${node.attributes[k].replace(/[&<>"\t\n\r]/g, c => CANON_ESCAPES[c])}"`)
    .join("");
  return `<${node.name}${attrs}>${node.children.map(writeCanonical).join("")}</${node.name}>`;
}

// Reference implementation of Bun.XML's compact projection (must match
// CompactSink in src/parsers/xml.rs): attributes as "@name"; a leaf with no
// attributes is its exact text; otherwise children keyed by name in order of
// first appearance (repeats as arrays) with "#text" — the concatenation of the
// text runs, minus whitespace-only runs between child elements (layout) —
// placed where the first kept run fell. Comments and PIs vanish (text runs on
// either side of one are a single run).
const XML_WS_ONLY = /^[ \t\r\n]*$/;
function toCompact(node: XNode): unknown {
  const obj: Record<string, unknown> = {};
  let hasAttributes = false;
  for (const [k, v] of Object.entries(node.attributes)) {
    defineOwn(obj, "@" + k, v);
    hasAttributes = true;
  }
  // Text runs as the compact builder sees them: split only by elements.
  const runs: (string | XNode)[] = [];
  for (const child of node.children) {
    if (typeof child === "object" && !("name" in child)) continue;
    if (typeof child === "string" && typeof runs[runs.length - 1] === "string") runs[runs.length - 1] += child;
    else runs.push(child);
  }
  const hasElements = runs.some(r => typeof r !== "string");
  if (!hasAttributes && !hasElements) return runs.join("");
  if (!hasElements) {
    const text = runs.join("");
    if (text) defineOwn(obj, "#text", text);
    return obj;
  }
  const order: string[] = [];
  const groups = new Map<string, unknown[]>();
  let text = "";
  for (const run of runs) {
    if (typeof run === "string") {
      if (XML_WS_ONLY.test(run)) continue;
      if (!text) order.push("#text");
      text += run;
      continue;
    }
    const value = toCompact(run);
    const group = groups.get(run.name);
    if (group) group.push(value);
    else {
      groups.set(run.name, [value]);
      order.push(run.name);
    }
  }
  for (const name of order) {
    if (name === "#text") defineOwn(obj, "#text", text);
    else {
      const values = groups.get(name)!;
      defineOwn(obj, name, values.length === 1 ? values[0] : values);
    }
  }
  return obj;
}
function defineOwn(obj: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
}

// ---------------------------------------------------------------------------
// 4. Classify inputs and capture in-tree behaviour
// ---------------------------------------------------------------------------
// A JS string handed to XML.parse is already-decoded text, so its encoding
// declaration is (correctly) not acted upon. Cases whose bytes carry encoding
// information the processor must act on — UTF-16, non-UTF-8 8-bit encodings,
// deliberately broken byte sequences, or any encoding declaration at all — are
// therefore passed as bytes; everything else is inlined as a string.
const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
type Input =
  | { kind: "string"; text: string }
  | { kind: "utf8-bytes"; text: string }
  | { kind: "bytes"; base64: string };
function classifyInput(bytes: Buffer): Input {
  const looks16 =
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0x00 && bytes[1] === 0x3c) ||
    (bytes[0] === 0x3c && bytes[1] === 0x00);
  if (!looks16) {
    try {
      const text = utf8Strict.decode(bytes);
      if (/^\ufeff?<\?xml[^>]*encoding/.test(text)) return { kind: "utf8-bytes", text };
      return { kind: "string", text };
    } catch {}
  }
  return { kind: "bytes", base64: bytes.toString("base64") };
}
function materialize(input: Input): string | Buffer {
  if (input.kind === "string") return input.text;
  if (input.kind === "utf8-bytes") return Buffer.from(input.text);
  return Buffer.from(input.base64, "base64");
}
function inputDecl(input: Input): string {
  if (input.kind === "string") return `const input: string = ${jsString(input.text)};`;
  if (input.kind === "utf8-bytes") return `const input = Buffer.from(${jsString(input.text)});`;
  return `const input = Buffer.from(${jsString(input.base64)}, "base64");`;
}

type Observed = { threw: true; message: string | undefined } | { threw: false; canonical: string; compact: unknown };
function observe(input: string | Buffer): Observed | undefined {
  if (!XML) return undefined;
  try {
    const node = XML.parse(input, { compact: false }) as XNode;
    return { threw: false, canonical: writeCanonical(node), compact: XML.parse(input) };
  } catch (e) {
    return { threw: true, message: e instanceof SyntaxError ? e.message : undefined };
  }
}

// ---------------------------------------------------------------------------
// 5. Code generation helpers
// ---------------------------------------------------------------------------
// JSON.stringify covers C0 controls, quotes, and backslashes; additionally
// escape DEL/C1 controls, U+2028/U+2029, U+FEFF and noncharacters so the
// generated source stays visibly ASCII-clean where it matters.
function jsString(s: string): string {
  return JSON.stringify(s).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function valueToJS(val: unknown, indent: number = 0): string {
  if (typeof val === "string") return jsString(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const items = val.map(v => valueToJS(v, indent + 1));
    const oneLine = `[${items.join(", ")}]`;
    if (oneLine.length < 80 && !oneLine.includes("\n")) return oneLine;
    const pad = "  ".repeat(indent + 1);
    const endPad = "  ".repeat(indent);
    return `[\n${items.map(i => `${pad}${i},`).join("\n")}\n${endPad}]`;
  }
  if (val !== null && typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const parts = entries.map(([k, v]) => {
      // A literal "__proto__" key would set the prototype; the computed form
      // creates an own property.
      const key = k === "__proto__" ? '["__proto__"]' : /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : jsString(k);
      return `${key}: ${valueToJS(v, indent + 1)}`;
    });
    const oneLine = `{ ${parts.join(", ")} }`;
    if (oneLine.length < 80 && !oneLine.includes("\n")) return oneLine;
    const pad = "  ".repeat(indent + 1);
    const endPad = "  ".repeat(indent);
    return `{\n${parts.map(p => `${pad}${p},`).join("\n")}\n${endPad}}`;
  }
  throw new Error(`Cannot serialize ${String(val)}`);
}

function comment(c: Case, extra?: string): string {
  const text = `${c.sections} — ${c.description}${extra ? ` (${extra})` : ""}`;
  // Wrap long descriptions so prettier leaves the lines alone.
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > 100) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.map(l => `    // ${l}\n`).join("");
}

function emitAccept(c: Case, decl: string, canonical: string | undefined, compact: unknown, extra?: string): string {
  let body = `  test(${jsString(c.id)}, () => {\n`;
  body += comment(c, extra);
  body += `    ${decl}\n`;
  if (canonical !== undefined) {
    body += `    const canonical = ${jsString(canonical)};\n`;
    body += `    const compact: unknown = ${valueToJS(compact, 2)};\n`;
    body += `    expectParses(input, canonical, compact);\n`;
  } else {
    body += `    expectParses(input);\n`;
  }
  body += `  });\n\n`;
  return body;
}

function emitReject(c: Case, decl: string, message: string | undefined, extra?: string): string {
  let body = `  test(${jsString(c.id)}, () => {\n`;
  body += comment(c, extra);
  body += `    ${decl}\n`;
  body += message === undefined ? `    expectRejects(input);\n` : `    expectRejects(input, ${jsString(message)});\n`;
  body += `  });\n\n`;
  return body;
}

function emitTodo(c: Case, decl: string, why: string): string {
  let body = `  test.todo(${jsString(c.id)}, () => {\n`;
  body += comment(c, why);
  body += `    ${decl}\n`;
  body += c.type === "not-wf" ? `    expectRejects(input);\n` : `    expectParses(input);\n`;
  body += `  });\n\n`;
  return body;
}

// ---------------------------------------------------------------------------
// 6. Emit
// ---------------------------------------------------------------------------
const counts = { reject: 0, accept: 0, acceptWithOutput: 0, pinned: 0, todo: 0 };
const bodies = new Map<string, string>();
for (const c of cases) {
  const input = classifyInput(c.input);
  const decl = inputDecl(input);
  const isNamespaceCase = c.recommendation.startsWith("NS1.0");
  const hard = c.entities === "none" && c.type !== "error" && !isNamespaceCase;
  let body: string;
  if (hard && c.type === "not-wf") {
    const observed = observe(materialize(input));
    body = emitReject(c, decl, observed?.threw ? observed.message : undefined);
    counts.reject++;
  } else if (hard) {
    let canonical: string | undefined;
    let compact: unknown;
    if (c.output !== undefined) {
      const tree = readCanonical(c.output, c.id);
      canonical = writeCanonical(tree);
      compact = { [tree.name]: toCompact(tree) };
      counts.acceptWithOutput++;
    }
    body = emitAccept(c, decl, canonical, compact);
    counts.accept++;
  } else {
    // Verdict depends on processor class; pin what Bun.XML does.
    const why = isNamespaceCase
      ? `upstream: ${c.type}; namespace constraints are not enforced`
      : c.type === "error"
        ? `upstream: optional error`
        : `upstream: ${c.type}; external ${c.entities === "both" ? "general and parameter" : c.entities} entities are not read`;
    const observed = observe(materialize(input));
    if (!observed) {
      body = emitTodo(c, decl, why);
      counts.todo++;
    } else if (observed.threw) {
      body = emitReject(c, decl, observed.message, why);
      counts.pinned++;
    } else {
      let canonical: string | undefined;
      let compact: unknown;
      if (c.output !== undefined) {
        const tree = readCanonical(c.output, c.id);
        if (writeCanonical(tree) === observed.canonical) {
          canonical = observed.canonical;
          compact = { [tree.name]: toCompact(tree) };
        }
      }
      body = emitAccept(
        c,
        decl,
        canonical,
        compact,
        canonical === undefined && c.output ? `${why}; output depends on them` : why,
      );
      counts.pinned++;
    }
  }
  bodies.set(c.collection, (bodies.get(c.collection) ?? "") + body);
}

let output = `// Tests generated from the W3C XML Conformance Test Suite, 20130923 release
// (https://www.w3.org/XML/Test/ — xmlts20130923.tar.gz, SHA-256 ${ARCHIVE_SHA256}).
// The suite was contributed by James Clark, Sun Microsystems, OASIS/NIST, IBM,
// Fuji Xerox and Richard Tobin / the University of Edinburgh; test documents are
// (c) their contributors ("Copyright 1998-1999 by Sun Microsystems, Inc.",
// "Modifications copyright 1999-2001 by OASIS", IBM 2000-2003, ...) and are
// inlined here verbatim as conformance inputs.
//
// Scope: ${cases.length} cases applicable to an XML 1.0 (Fifth Edition) processor —
// ${counts.reject} must-reject + ${counts.accept} must-accept (${counts.acceptWithOutput} with canonical output) + ${counts.pinned + counts.todo} whose
// verdict depends on processor class (pinned to Bun's behaviour, see below).
// Skipped: ${skipped11} XML 1.1 / Namespaces 1.1 cases, ${skippedEdition} cases restricted to editions 1-4
// (superseded by Fifth Edition erratum E09), ${skippedBig} large japanese/pr-xml-* samples
// (advisory only; the japanese/weekly-* cases cover the same encodings).
// Regenerate with: bun bd test/js/bun/xml/generate_xml_test_suite.ts [path-to-xmlconf]
//
// Bun.XML is a non-validating processor that does not read external entities
// (XML 1.0 §5.1), so:
//   - not-wf cases with ENTITIES="none" must throw SyntaxError (exact message
//     asserted);
//   - valid and invalid cases with ENTITIES="none" must parse (non-validating
//     processors accept invalid-but-well-formed documents); when the suite gives
//     a canonical output, the { compact: false } tree must serialize to it
//     exactly (Second Canonical Form, minus the DOCTYPE/notation block and
//     processing instructions, which Bun.XML does not represent), the compact
//     object must equal the projection of that output, and XML.stringify of
//     either shape must parse back to the same value;
//   - cases with external entities, TYPE="error" cases, and the Namespaces 1.0
//     collection (names are opaque strings to Bun.XML; namespace constraints are
//     not enforced) are pinned to the in-tree behaviour, with the upstream
//     verdict in the comment.
// Inputs whose bytes carry encoding information the processor must act on (an
// encoding declaration, a UTF-16 BOM, non-UTF-8 bytes) are passed as bytes; a JS
// string is already-decoded text and its encoding declaration is not acted upon.
import { XML } from "bun";
import { describe, expect, test } from "bun:test";

type XMLNode = XML.Node;

const CANON_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\\t": "&#9;",
  "\\n": "&#10;",
  "\\r": "&#13;",
};
function codePointCompare(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < x.length && i < y.length; i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
/** James Clark's Canonical XML for an element tree. */
function canonicalize(node: XMLNode | XML.Comment | XML.ProcessingInstruction | string): string {
  if (typeof node === "string") return node.replace(/[&<>"\\t\\n\\r]/g, c => CANON_ESCAPES[c]);
  if ("comment" in node) return "";
  if ("target" in node) return \`<?\${node.target} \${node.data}?>\`;
  const attrs = Object.keys(node.attributes)
    .sort(codePointCompare)
    .map(k => \` \${k}="\${node.attributes[k].replace(/[&<>"\\t\\n\\r]/g, c => CANON_ESCAPES[c])}"\`)
    .join("");
  return \`<\${node.name}\${attrs}>\${node.children.map(canonicalize).join("")}</\${node.name}>\`;
}

function tree(input: string | Buffer): XMLNode {
  return XML.parse(input, { compact: false });
}

function expectParses(input: string | Buffer, canonical?: string, compact?: unknown): void {
  const node = tree(input);
  const object = XML.parse(input);
  if (canonical !== undefined) {
    expect(canonicalize(node)).toBe(canonical);
    expect(object).toEqual(compact);
  }
  // stringify of either shape reads back as the same value.
  expect(canonicalize(tree(XML.stringify(node)))).toBe(canonicalize(node));
  expect(XML.parse(XML.stringify(object))).toEqual(object);
}

function expectRejects(input: string | Buffer, message?: string): void {
  let err: unknown;
  try {
    XML.parse(input);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SyntaxError);
  if (message !== undefined) expect((err as SyntaxError).message).toBe(message);
  expect(() => tree(input)).toThrow(SyntaxError);
}
`;

for (const name of new Set(COLLECTIONS.map(c => c.describe))) {
  const body = bodies.get(name);
  if (!body) continue;
  output += `\ndescribe(${jsString(name)}, () => {\n${body}});\n`;
}

const committedPath = join(import.meta.dir, "xml-test-suite.test.ts");
// The --check comparand must sit beside the committed file: prettier 3 also
// honors .gitignore, whose bare `tmp` rule matches os.tmpdir() on Linux and
// makes prettier silently skip the file there instead of formatting it.
const outPath = checkMode ? join(import.meta.dir, "xml-test-suite.check.ts") : committedPath;
writeFileSync(outPath, output);
const repoRoot = join(import.meta.dir, "../../../..");
execFileSync(
  join(repoRoot, "node_modules/.bin/prettier"),
  ["--plugin=prettier-plugin-organize-imports", "--config", join(repoRoot, ".prettierrc"), "--write", outPath],
  { stdio: "inherit", cwd: repoRoot },
);
if (checkMode) {
  const fresh = readFileSync(outPath, "utf8");
  const committed = readFileSync(committedPath, "utf8");
  if (fresh !== committed) {
    console.error(
      `MISMATCH: ${committedPath} is stale; regenerate it (fresh output kept at ${outPath} for comparison).`,
    );
    process.exit(1);
  }
  rmSync(outPath);
  console.log(`OK: ${committedPath} is up to date.`);
} else {
  console.log(
    `Wrote ${outPath}: ${counts.reject} must-reject + ${counts.accept} must-accept (${counts.acceptWithOutput} with output) + ${counts.pinned} pinned + ${counts.todo} todo`,
  );
}

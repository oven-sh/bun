// What WPT's own server and manifest tool do, as far as the harness needs it: which files are tests, the page
// around a `.any.js` or `.window.js` test, and `{{...}}` in `.sub.` files.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

export const resultPrefix = "WPT-RESULT ";

const serverAliases = { "/resources/WebIDLParser.js": "/resources/webidl2/lib/webidl2.js" };

// The file that WPT's server would send for a URL path, or null.
export function findFile(wptDirectory, path) {
  const file = normalize(join(wptDirectory, decodeURIComponent(serverAliases[path] ?? path)));
  return file.startsWith(normalize(wptDirectory + sep)) && existsSync(file) && statSync(file).isFile() ? file : null;
}

const host = "web-platform.test";
const ports = { http: [8000, 8001], https: [8443, 8444], ws: [8666], wss: [8667] };

export function testOrigin(path) {
  return /\.https\./.test(path) ? `https://${host}:${ports.https[0]}` : `http://${host}:${ports.http[0]}`;
}

export function substituteServerVariables(text, url) {
  return text.replace(/\{\{([^{}]+)\}\}/g, (whole, expression) => {
    const [name, ...keys] = expression
      .trim()
      .split(/[[\]]+/)
      .filter(Boolean);
    switch (name) {
      case "host":
        return host;
      case "domains":
      case "hosts":
        return keys.at(-1) ? `${keys.at(-1)}.${host}` : host;
      case "ports":
        return String(ports[keys[0]]?.[Number(keys[1])] ?? whole);
      case "location":
        return (
          {
            scheme: url.protocol.slice(0, -1),
            host: url.host,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            pathname: url.pathname,
            query: url.search,
            server: url.origin,
          }[keys[0]] ?? whole
        );
      case "GET":
        return url.searchParams.get(keys[0]) ?? "";
      default:
        return whole;
    }
  });
}

function readMetadata(source) {
  const metadata = [];
  for (const line of source.split("\n")) {
    const match = /^\/\/ META: ([^=]+)=(.*)$/.exec(line.trimEnd());
    if (match) metadata.push([match[1].trim(), match[2].trim()]);
    else if (line.trim() && !line.startsWith("//")) break;
  }
  return metadata;
}

const escapeAttribute = text => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

// WPT's server makes `x.any.html` and `x.window.html` from `x.any.js` and `x.window.js`.
export function scriptPathForGeneratedPage(path) {
  return /\.(?:any|window)\.html$/.test(path) ? path.replace(/\.html$/, ".js") : null;
}

export function markupForScriptTest(scriptPath, source) {
  const head = [];
  const scripts = [];
  for (const [name, value] of readMetadata(source)) {
    if (name === "timeout") head.push(`<meta name="timeout" content="${escapeAttribute(value)}">`);
    else if (name === "title") head.push(`<title>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</title>`);
    else if (name === "script") scripts.push(`<script src="${escapeAttribute(value)}"></script>`);
  }
  return `<!doctype html>
<meta charset=utf-8>
${head.join("\n")}
<script>
self.GLOBAL = {
  isWindow: function() { return true; },
  isWorker: function() { return false; },
  isShadowRealm: function() { return false; },
};
</script>
<script src="/resources/testharness.js"></script>
<script src="/resources/testharnessreport.js"></script>
${scripts.join("\n")}
<div id=log></div>
<script src="${escapeAttribute(scriptPath)}"></script>
`;
}

const supportDirectories = new Set(["resources", "support", "tools"]);

// Returns `{ path, kind, reason }` for each file under `directory` that WPT's manifest would call a test.
// `kind` is "testharness" or "crashtest" for the ones the harness can load, and "skipped" with a reason for the rest.
export function listTests(wptDirectory, directory) {
  const tests = [];
  const visit = relative => {
    const entries = readdirSync(join(wptDirectory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = `${relative}/${entry.name}`;
      if (!entry.isDirectory()) tests.push(...classify(wptDirectory, path));
      else if (!supportDirectories.has(entry.name)) visit(path);
    }
  };
  visit(directory.replace(/^\/+|\/+$/g, ""));
  return tests;
}

export const isCrashTest = path => /-crash\.|\/crashtests\//.test(path);

function classify(wptDirectory, relative) {
  const path = "/" + relative;
  const skipped = reason => [{ path, kind: "skipped", reason }];
  if (/-manual\./.test(path)) return skipped("manual test");
  if (/\.worker\.js$/.test(path)) return skipped("runs in a Worker");
  if (/\.(?:any|window)\.js$/.test(path)) {
    const metadata = readMetadata(readFileSync(join(wptDirectory, relative), "utf8"));
    const globals = metadata
      .find(([name]) => name === "global")?.[1]
      .split(",")
      .map(name => name.trim());
    if (path.endsWith(".any.js") && globals && !globals.includes("window"))
      return skipped(`global=${globals.join(",")}`);
    const variants = metadata.filter(([name]) => name === "variant").map(([, value]) => value);
    const page = path.replace(/\.js$/, ".html");
    return (variants.length ? variants : [""]).map(variant => ({ path: page + variant, kind: "testharness" }));
  }
  if (/\.(?:xhtml|xht|xml|svg)$/.test(path)) return skipped("needs an XML parser");
  if (!/\.html?$/.test(path)) return [];
  const source = readFileSync(join(wptDirectory, relative), "utf8");
  if (isCrashTest(path)) return [{ path, kind: "crashtest" }];
  if (/<link[^>]+rel=["']?(?:mis)?match/i.test(source)) return skipped("reftest");
  if (!/<script[^>]+src=["']?[^"' >]*\/testharness\.js/i.test(source)) return [];
  const variantPattern = /<meta[^>]+name=["']?variant["']?[^>]+content=(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;
  const variants = [...source.matchAll(variantPattern)].map(match => match[1] ?? match[2] ?? match[3]);
  return (variants.length ? variants : [""]).map(variant => ({ path: path + variant, kind: "testharness" }));
}

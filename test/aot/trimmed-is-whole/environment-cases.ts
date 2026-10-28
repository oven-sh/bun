import type { Case, Program } from "./environment";

const preloaded = { "pre.ts": `console.log("preloaded", typeof HTMLRewriter, Bun.color("red", "hex"));` };
const shows: Program[] = ["hello", "tells"];

const valuesOfOptions: Record<string, string[]> = {
  "--env-file": ["<run>/other.env"],
  "--cwd": ["<run>/sub"],
  "--config": ["<run>/own.toml"],
  "--tsconfig-override": ["<run>/tsconfig.other.json"],
  "--define": ["process.env.NODE_ENV:\"defined\""],
  "--drop": ["console"],
  "--loader": [".js:jsx"],
  "--jsx-runtime": ["classic"],
  "--watch-kill-signal": ["SIGINT"],
  "--preload": ["<run>/pre.ts"],
  "--require": ["<run>/pre.ts"],
  "--import": ["<run>/pre.ts"],
  "--inspect": ["", "127.0.0.1:0"],
  "--inspect-wait": ["127.0.0.1:0"],
  "--inspect-brk": ["127.0.0.1:0"],
  "--cpu-prof-name": ["own.cpuprofile"],
  "--cpu-prof-dir": ["<run>/profiles"],
  "--cpu-prof-interval": ["500"],
  "--heap-prof-name": ["own.heapprofile"],
  "--heap-prof-dir": ["<run>/profiles"],
  "--heap-prof-interval": ["1024"],
  "--install": ["auto", "fallback", "force"],
  "--eval": ["console.log('evaluated')"],
  "--print": ["1+1"],
  "--port": ["0"],
  "--conditions": ["own"],
  "--fetch-preconnect": ["http://127.0.0.1:9"],
  "--max-http-header-size": ["64", "100000"],
  "--dns-result-order": ["ipv4first", "ipv6first", "verbatim", "nonsense"],
  "--title": ["own title"],
  "--redirect-warnings": ["<run>/warnings.txt"],
  "--disable-warning": ["OWN", "DeprecationWarning"],
  "--unhandled-rejections": ["strict", "throw", "warn", "none", "warn-with-error-code", "nonsense"],
  "--console-depth": ["0", "1", "9"],
  "--user-agent": ["own agent"],
  "--shell": ["bun", "system"],
  "--filter": ["*"],
  "--elide-lines": ["1"],
  "--main-fields": ["module"],
  "--extension-order": [".ts"],
  "--jsx-factory": ["h"],
  "--jsx-fragment": ["Fragment"],
  "--jsx-import-source": ["own"],
  "--feature": ["OWN"],
  "--secure-heap": ["4096"],
  "--secure-heap-min": ["2"],
};

const filesOfOptions = {
  ...preloaded,
  "other.env": "FROM_DOT_ENV=another file\n",
  "sub/keep": "",
  "own.toml": "[console]\ndepth = 1\n",
  "tsconfig.other.json": "{}",
};

export function casesOfOptions(options: { name: string; takesValue: boolean }[], programs?: Program[]): Case[] {
  const cases: Case[] = [];
  for (const { name, takesValue } of options) {
    const values = valuesOfOptions[name] ?? (takesValue ? ["x", "1"] : [""]);
    for (const value of values) {
      const option = value === "" ? name : name + "=" + value;
      cases.push({ name: "BUN_OPTIONS=" + option, env: { BUN_OPTIONS: /\s/.test(option) ? `'${option}'` : option }, files: filesOfOptions, programs });
    }
  }
  return cases;
}

export const optionsThatHelpDoesNotList = [
  "--version", "-v", "--revision", "-h", "--breakpoint-resolve=x", "--aot-graph-fd=9", "--aot-decode-crash-report=x", "--origin=http://localhost", "-u=http://localhost",
  "--disallow-code-generation-from-strings", "--disallow-code-generation-from-strings=strict", "--disallow-code-generation-from-strings=eval",
  "--trace-event-categories=node", "--trace-event-file-pattern=<run>/trace.log", "--stack-trace-limit=1", "--stack-trace-limit=0",
  "--trace-env", "--trace-exit", "--trace-uncaught", "--trace-sigint", "--trace-env-js-stack", "--trace-nonsense",
  "-r=<run>/pre.ts", "-e=1", "-p=1", "-c=<run>/own.toml", "-d=A:1", "-l=.js:jsx", "-i", "-b", "-F=*",
  "--debug-dump-server-files", "--debug-no-minify", "--production", "--compile", "--nonsense", "-Z", "positional", "run", "install", "--", "",
  "--tls-min-v1.2", "--tls-max-v1.2", "--tls-min-v1.3", "--tls-cipher-list=x", "--secure-heap=4096", "--enable-source-maps", "--max-old-space-size=64", "--no-experimental-fetch", "--experimental-vm-modules",
  "--smol --expose-gc --console-depth=1", "--cpu-prof --cpu-prof-dir=<run>/profiles --cpu-prof-name=own.cpuprofile --cpu-prof-interval=500", "--heap-prof --heap-prof-dir=<run>/profiles --heap-prof-name=own.heapprofile",
  "--cron-title=own --cron-period=hourly",
];

export const casesOfOtherOptions: Case[] = [
  ...optionsThatHelpDoesNotList.map((option): Case => ({ name: "BUN_OPTIONS=" + option, env: { BUN_OPTIONS: option }, files: filesOfOptions })),
  ...["--trace-own", "--trace-warnings", "--stack-trace-limit=1", "--stack-trace-limited"].map((arg): Case => ({ name: "an argument of the program's own: " + arg, args: [arg] })),
];

export function casesOfVariables(names: string[]): Case[] {
  const values = ["1", "0", "<run>/named", "ws://127.0.0.1:0/own", "nonsense value"];
  return names.flatMap(name => values.map(value => ({ name: `${name}=${value}`, env: { [name]: value } })));
}

export const cases: Case[] = [
  { name: "nothing special" },

  { name: "arguments", args: ["one", "--two", "-3"], programs: shows },
  { name: "arguments that Bun has too", args: ["--version", "--help", "--smol", "--inspect", "-e", "1"], programs: shows },
  { name: "arguments behind --", args: ["--", "--version", "one"], programs: shows },
  { name: "BUN_BE_BUN=1 --version", env: { BUN_BE_BUN: "1" }, args: ["--version"], programs: ["hello"] },
  { name: "BUN_BE_BUN=1 --revision", env: { BUN_BE_BUN: "1" }, args: ["--revision"], programs: ["hello"] },
  { name: "BUN_BE_BUN=1 a file", env: { BUN_BE_BUN: "1" }, args: ["<run>/pre.ts"], files: preloaded, programs: ["hello"] },
  { name: "BUN_BE_BUN=1 -e", env: { BUN_BE_BUN: "1" }, args: ["-e", "console.log(1 + 1)"], programs: ["hello"] },
  { name: "BUN_BE_BUN=1 and nothing else", env: { BUN_BE_BUN: "1" }, programs: ["hello"] },
  { name: "BUN_BE_BUN=0", env: { BUN_BE_BUN: "0" }, args: ["--version"], programs: shows },

  ...["node", "bun", "bunx", "bun-debug", "npm", "sh"].map((calledAs): Case => ({ name: "called as " + calledAs, calledAs, args: ["--version"], programs: shows })),
  { name: "started with a channel to its parent", ipc: "json", programs: ["hello", "serve", "tells"] },
  { name: "started with a channel to its parent that carries structured clones", ipc: "advanced", programs: ["hello", "serve", "tells"] },

  { name: ".env", files: { ".env": "FROM_DOT_ENV=dot env\n" }, programs: shows },
  { name: ".env.local, .env.production, .env.development", files: { ".env.local": "FROM_DOT_ENV=local\n", ".env.production": "FROM_DOT_ENV=production\n", ".env.development": "FROM_DOT_ENV=development\n" }, programs: shows },
  { name: ".env with NODE_ENV=production", env: { NODE_ENV: "production" }, files: { ".env.production": "FROM_DOT_ENV=production\n" }, programs: shows },
  { name: ".env that expands and quotes", files: { ".env": "BASE=base\nFROM_DOT_ENV=\"${BASE} and 'more'\"\n" }, programs: shows },
  { name: ".env that sets BUN_OPTIONS", files: { ".env": "BUN_OPTIONS=--console-depth=0\n" }, programs: shows },
  { name: ".env that sets TZ", files: { ".env": "TZ=Asia/Tokyo\n" }, programs: shows },
  { name: ".env that sets NO_COLOR and FORCE_COLOR", files: { ".env": "FORCE_COLOR=1\n" }, programs: shows },
  { name: ".env, built without it", build: ["--no-compile-autoload-dotenv"], files: { ".env": "FROM_DOT_ENV=dot env\n" }, programs: shows },

  { name: "bunfig.toml, built to read it: console.depth", build: ["--compile-autoload-bunfig"], files: { "bunfig.toml": "[console]\ndepth = 1\n" }, programs: shows },
  { name: "bunfig.toml, built to read it: preload", build: ["--compile-autoload-bunfig"], files: { "bunfig.toml": `preload = ["./pre.ts"]\n`, ...preloaded }, programs: shows },
  { name: "bunfig.toml, built to read it: smol, logLevel, telemetry, define", build: ["--compile-autoload-bunfig"], files: { "bunfig.toml": `smol = true\nlogLevel = "debug"\ntelemetry = false\n[define]\n"process.env.OWN" = "'1'"\n` }, programs: shows },
  { name: "bunfig.toml, built to read it: not TOML", build: ["--compile-autoload-bunfig"], files: { "bunfig.toml": "= = =\n" }, programs: shows },
  { name: "bunfig.toml, built not to read it", build: ["--no-compile-autoload-bunfig"], files: { "bunfig.toml": "[console]\ndepth = 1\n" }, programs: shows },
  { name: "package.json and tsconfig.json in the working directory", files: { "package.json": `{ "name": "own", "type": "commonjs" }`, "tsconfig.json": `{ "compilerOptions": { "paths": { "x": ["./y"] } } }` } },
  { name: "package.json and tsconfig.json, built to read them", build: ["--compile-autoload-package-json", "--compile-autoload-tsconfig"], files: { "package.json": `{ "name": "own" }`, "tsconfig.json": `{ "compilerOptions": { "paths": { "x": ["./y"] } } }` } },

  ...["--smol", "--expose-gc", "--console-depth=1", "--title=own", "--no-deprecation", "--throw-deprecation", "--unhandled-rejections=strict", "--inspect=127.0.0.1:0", "--cpu-prof", "--heap-prof", "--dns-result-order=ipv4first", "--max-http-header-size=64", "--use-system-ca", "--zero-fill-buffers", "--user-agent=own", "--port=0", "--conditions=own", "--config=own.toml", "-c=own.toml", "--env-file=other.env", "--preload=./pre.ts"].map(
    (option): Case => ({ name: "built with --compile-exec-argv=" + option, build: ["--compile-exec-argv=" + option], files: filesOfOptions, programs: shows }),
  ),

  ...(["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGUSR1", "SIGUSR2", "SIGPIPE", "SIGWINCH", "SIGCONT", "SIGALRM", "SIGCHLD", "SIGURG", "SIGTSTP"] as NodeJS.Signals[]).map((signal): Case => ({ name: signal, signal })),
  ...(["SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE", "SIGABRT", "SIGTRAP", "SIGSYS"] as NodeJS.Signals[]).map((signal): Case => ({ name: signal + ", which the crash handler takes", signal, numbersMayDiffer: true })),

  { name: "a crash is reported to a server of ours", env: { BUN_CRASH_REPORT_URL: "<report url>", BUN_ENABLE_CRASH_REPORTING: "1" }, signal: "SIGSEGV", numbersMayDiffer: true },
  { name: "a crash is not reported with DO_NOT_TRACK=1 and no server named", env: { BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1" }, signal: "SIGSEGV", numbersMayDiffer: true },

  ...["C", "POSIX", "en_US.UTF-8", "de_DE.UTF-8", "tr_TR.UTF-8", "ja_JP.UTF-8", "ar_EG.UTF-8", "hi_IN", "sv_SE.ISO-8859-1", "nonsense", ""].flatMap((locale): Case[] => [
    { name: "LANG=" + locale, env: { LANG: locale }, programs: shows },
    { name: "LC_ALL=" + locale, env: { LC_ALL: locale }, programs: shows },
  ]),
  { name: "LC_MESSAGES, LC_CTYPE, LC_TIME, LC_NUMERIC, LC_COLLATE", env: { LC_MESSAGES: "de_DE.UTF-8", LC_CTYPE: "tr_TR.UTF-8", LC_TIME: "ja_JP.UTF-8", LC_NUMERIC: "de_DE.UTF-8", LC_COLLATE: "sv_SE.UTF-8" }, programs: shows },
  { name: "LANGUAGE", env: { LANGUAGE: "de:fr" }, programs: shows },
  ...["UTC", "America/Los_Angeles", "Asia/Kolkata", "Europe/Berlin", "Australia/Lord_Howe", "EST5EDT", "<+03>-3", ":/etc/localtime", "Nonsense/Zone", ""].map((zone): Case => ({ name: "TZ=" + zone, env: { TZ: zone }, programs: shows })),
  // Where the data of ICU is linked in. On macOS ICU is the system's, which looks for its data under these names.
  ...(process.platform === "darwin" ? [] : [{ name: "ICU_DATA, ICU_TIMEZONE_FILES_DIR", env: { ICU_DATA: "<run>", ICU_TIMEZONE_FILES_DIR: "<run>" }, programs: shows } as Case]),

  ...["dumb", "xterm-256color", "xterm-kitty", ""].map((term): Case => ({ name: "TERM=" + term, env: { TERM: term } })),
  { name: "NO_COLOR=1", env: { NO_COLOR: "1" } },
  { name: "FORCE_COLOR=1", env: { FORCE_COLOR: "1" } },
  { name: "FORCE_COLOR=0", env: { FORCE_COLOR: "0" } },
  { name: "FORCE_COLOR=3, COLORTERM=truecolor", env: { FORCE_COLOR: "3", COLORTERM: "truecolor" } },
  { name: "NO_COLOR=1, FORCE_COLOR=1", env: { NO_COLOR: "1", FORCE_COLOR: "1" } },
  { name: "COLUMNS=20, LINES=5", env: { COLUMNS: "20", LINES: "5" } },
  { name: "CI=1, GITHUB_ACTIONS=1", env: { CI: "1", GITHUB_ACTIONS: "1" } },
  { name: "AGENT=1", env: { AGENT: "1" } },

  { name: "a terminal", stdin: "terminal", stdout: "terminal", stderr: "terminal", programs: ["hello", "tells", "throws", "rejects", "warns"] },
  { name: "a terminal, TERM=xterm-256color", env: { TERM: "xterm-256color" }, stdin: "terminal", stdout: "terminal", stderr: "terminal", programs: ["hello", "tells", "throws", "rejects", "warns"] },
  { name: "a terminal, NO_COLOR=1", env: { NO_COLOR: "1", TERM: "xterm-256color" }, stdin: "terminal", stdout: "terminal", stderr: "terminal", programs: ["hello", "tells", "throws"] },
  ...(["pipe", "closed", "file", "null"] as const).map((stdin): Case => ({ name: "stdin: " + stdin, stdin, programs: ["hello", "tells", "reads"] })),
  ...(["closed", "file", "null"] as const).map((stdout): Case => ({ name: "stdout: " + stdout, stdout, programs: ["hello", "tells", "throws", "warns"] })),
  ...(["closed", "file", "null"] as const).map((stderr): Case => ({ name: "stderr: " + stderr, stderr, programs: ["hello", "tells", "throws", "warns", "rejects"] })),
  { name: "stdin, stdout and stderr closed", stdin: "closed", stdout: "closed", stderr: "closed", programs: ["hello", "tells", "throws", "warns", "rejects", "reads"] },

  { name: "HOME and TMPDIR that do not exist", env: { HOME: "<run>/no/home", TMPDIR: "<run>/no/tmp" } },
  { name: "HOME and TMPDIR empty", env: { HOME: "", TMPDIR: "" } },
  { name: "BUN_TMPDIR, BUN_INSTALL, XDG_*", env: { BUN_TMPDIR: "<run>", BUN_INSTALL: "<run>", XDG_CACHE_HOME: "<run>", XDG_CONFIG_HOME: "<run>", XDG_DATA_HOME: "<run>" } },
  { name: "a global bunfig in HOME and XDG_CONFIG_HOME", env: { HOME: "<run>", XDG_CONFIG_HOME: "<run>" }, files: { ".bunfig.toml": "[console]\ndepth = 0\n" }, programs: shows },
  { name: "PATH empty", env: { PATH: "" } },

  { name: "proxies", env: { HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", NO_PROXY: "example.com", ALL_PROXY: "http://127.0.0.1:9" } },
  { name: "proxies that are not URLs", env: { HTTP_PROXY: "not a url", HTTPS_PROXY: "::::" } },
  { name: "NODE_USE_ENV_PROXY=1", env: { NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://127.0.0.1:9" } },
  { name: "NODE_EXTRA_CA_CERTS that does not exist", env: { NODE_EXTRA_CA_CERTS: "<run>/none.pem" } },
  { name: "NODE_EXTRA_CA_CERTS that is not a certificate", env: { NODE_EXTRA_CA_CERTS: "<run>/not.pem" }, files: { "not.pem": "not a certificate\n" } },
  { name: "SSL_CERT_FILE, SSL_CERT_DIR", env: { SSL_CERT_FILE: "<run>/not.pem", SSL_CERT_DIR: "<run>" }, files: { "not.pem": "not a certificate\n" } },
  { name: "NODE_TLS_REJECT_UNAUTHORIZED=0", env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" } },
  { name: "NODE_USE_SYSTEM_CA=1", env: { NODE_USE_SYSTEM_CA: "1" } },

  ...(
    [
      ["nothing special", {}],
      ["NODE_TLS_REJECT_UNAUTHORIZED=0", { NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["NODE_EXTRA_CA_CERTS, the right certificate", { NODE_EXTRA_CA_CERTS: "<run>/right.pem" }],
      ["NODE_EXTRA_CA_CERTS, not a certificate", { NODE_EXTRA_CA_CERTS: "<run>/not.pem" }],
      ["NODE_EXTRA_CA_CERTS, no such file", { NODE_EXTRA_CA_CERTS: "<run>/none.pem" }],
      ["SSL_CERT_FILE, the right certificate", { SSL_CERT_FILE: "<run>/right.pem" }],
      ["SSL_CERT_FILE with NODE_USE_SYSTEM_CA=1", { SSL_CERT_FILE: "<run>/right.pem", NODE_USE_SYSTEM_CA: "1" }],
      ["SSL_CERT_DIR with NODE_USE_SYSTEM_CA=1", { SSL_CERT_DIR: "<run>", NODE_USE_SYSTEM_CA: "1" }],
      ["NODE_USE_SYSTEM_CA=1", { NODE_USE_SYSTEM_CA: "1" }],
      ["BUN_OPTIONS=--use-system-ca", { BUN_OPTIONS: "--use-system-ca" }],
      ["BUN_OPTIONS=--use-system-ca, SSL_CERT_FILE", { BUN_OPTIONS: "--use-system-ca", SSL_CERT_FILE: "<run>/right.pem" }],
      ["BUN_OPTIONS=--use-openssl-ca", { BUN_OPTIONS: "--use-openssl-ca" }],
      ["BUN_OPTIONS=--use-openssl-ca, SSL_CERT_FILE", { BUN_OPTIONS: "--use-openssl-ca", SSL_CERT_FILE: "<run>/right.pem" }],
      ["BUN_OPTIONS=--use-bundled-ca", { BUN_OPTIONS: "--use-bundled-ca" }],
      ["BUN_OPTIONS=--tls-min-v1.3", { BUN_OPTIONS: "--tls-min-v1.3", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_OPTIONS=--tls-max-v1.2", { BUN_OPTIONS: "--tls-max-v1.2", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_OPTIONS=--tls-cipher-list", { BUN_OPTIONS: "--tls-cipher-list=ECDHE-RSA-AES128-GCM-SHA256", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_OPTIONS=--user-agent", { BUN_OPTIONS: "'--user-agent=own agent'" }],
      ["BUN_OPTIONS=--dns-result-order=ipv6first", { BUN_OPTIONS: "--dns-result-order=ipv6first", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_OPTIONS=--dns-result-order=ipv4first", { BUN_OPTIONS: "--dns-result-order=ipv4first", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_OPTIONS=--experimental-http2-fetch", { BUN_OPTIONS: "--experimental-http2-fetch", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_OPTIONS=--experimental-http3-fetch", { BUN_OPTIONS: "--experimental-http3-fetch", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1", { BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_OPTIONS=--fetch-preconnect", { BUN_OPTIONS: "--fetch-preconnect=<plain url>" }],
      ["BUN_OPTIONS=--max-http-header-size=64", { BUN_OPTIONS: "--max-http-header-size=64" }],
      ["BUN_CONFIG_VERBOSE_FETCH=curl", { BUN_CONFIG_VERBOSE_FETCH: "curl", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_CONFIG_VERBOSE_FETCH=true", { BUN_CONFIG_VERBOSE_FETCH: "true", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["a proxy that nobody listens on", { HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9" }],
      ["a proxy that nobody listens on, and NO_PROXY", { HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost" }],
      ["a proxy over TLS that nobody listens on", { HTTP_PROXY: "https://127.0.0.1:9", HTTPS_PROXY: "https://127.0.0.1:9" }],
      ["a proxy with a user and a password", { HTTP_PROXY: "http://user:secret@127.0.0.1:9" }],
      ["a proxy that is not a URL", { HTTP_PROXY: "not a url", HTTPS_PROXY: "::::" }],
      ["the plain server as the proxy", { HTTP_PROXY: "<plain url>", HTTPS_PROXY: "<plain url>" }],
      ["SSLKEYLOGFILE", { SSLKEYLOGFILE: "<run>/keys.log", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_FEATURE_FLAG_DISABLE_DNS_CACHE, DISABLE_IPV6, DISABLE_ADDRCONFIG", { BUN_FEATURE_FLAG_DISABLE_DNS_CACHE: "1", BUN_FEATURE_FLAG_DISABLE_IPV6: "1", BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG: "1", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
      ["BUN_FEATURE_FLAG_DISABLE_FETCH_TLS_SESSION_CACHE", { BUN_FEATURE_FLAG_DISABLE_FETCH_TLS_SESSION_CACHE: "1", NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
    ] as [string, Record<string, string>][]
  ).map(([name, env]): Case => ({ name: "fetch: " + name, env, files: { "right.pem": "<certificate>", "not.pem": "not a certificate\n" }, programs: ["fetches"] })),

  { name: "NODE_OPTIONS=--require", env: { NODE_OPTIONS: "--require <run>/pre.ts" }, files: preloaded },
  { name: "NODE_OPTIONS=--inspect", env: { NODE_OPTIONS: "--inspect=127.0.0.1:0" } },
  { name: "NODE_OPTIONS=--max-old-space-size", env: { NODE_OPTIONS: "--max-old-space-size=64" } },
  { name: "NODE_ENV=production", env: { NODE_ENV: "production" } },
  { name: "NODE_ENV=development", env: { NODE_ENV: "development" } },
  { name: "NODE_ENV=staging", env: { NODE_ENV: "staging" } },
  { name: "BUN_ENV=test", env: { BUN_ENV: "test" } },
  { name: "NODE_DEBUG=*", env: { NODE_DEBUG: "*" } },
  { name: "NODE_DEBUG=http,net,fs,stream,timers", env: { NODE_DEBUG: "http,net,fs,stream,timers" } },
  { name: "NODE_NO_WARNINGS=1", env: { NODE_NO_WARNINGS: "1" } },
  { name: "NODE_PENDING_DEPRECATION=1", env: { NODE_PENDING_DEPRECATION: "1" } },
  { name: "NODE_PATH", env: { NODE_PATH: "<run>" } },
  { name: "NODE_CHANNEL_FD that is not open", env: { NODE_CHANNEL_FD: "99" } },
  { name: "NODE_CHANNEL_FD=0, advanced", env: { NODE_CHANNEL_FD: "0", NODE_CHANNEL_SERIALIZATION_MODE: "advanced" } },
  { name: "NODE_UNIQUE_ID, as in a cluster", env: { NODE_UNIQUE_ID: "1" } },
  { name: "NODE_V8_COVERAGE", env: { NODE_V8_COVERAGE: "<run>/coverage" } },
  { name: "NODE_COMPILE_CACHE", env: { NODE_COMPILE_CACHE: "<run>/cache" } },

  { name: "BUN_INSPECT", env: { BUN_INSPECT: "ws://127.0.0.1:0/own" } },
  { name: "BUN_INSPECT that waits", env: { BUN_INSPECT: "ws://127.0.0.1:0/own?wait=1" }, programs: ["hello"] },
  { name: "BUN_INSPECT_CONNECT_TO nobody", env: { BUN_INSPECT_CONNECT_TO: "unix://<run>/none.sock" } },
  { name: "BUN_INSPECT_NOTIFY nobody", env: { BUN_INSPECT_NOTIFY: "unix://<run>/none.sock", BUN_INSPECT: "ws://127.0.0.1:0/own" } },
  { name: "BUN_INSPECT_PRELOAD", env: { BUN_INSPECT_PRELOAD: "<run>/pre.ts" }, files: preloaded },

  { name: "BUN_PORT, NODE_PORT", env: { BUN_PORT: "0", NODE_PORT: "0" } },
  { name: "BUN_CONFIG_VERBOSE_FETCH=curl", env: { BUN_CONFIG_VERBOSE_FETCH: "curl" } },
  { name: "BUN_CONFIG_MAX_HTTP_REQUESTS, BUN_CONFIG_HTTP_IDLE_TIMEOUT, BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS", env: { BUN_CONFIG_MAX_HTTP_REQUESTS: "1", BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1", BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS: "1" } },
  { name: "BUN_GARBAGE_COLLECTOR_LEVEL=2", env: { BUN_GARBAGE_COLLECTOR_LEVEL: "2" } },
  { name: "BUN_GC_TIMER_DISABLE, BUN_GC_TIMER_INTERVAL, BUN_IDLE_GC_SECONDS", env: { BUN_GC_TIMER_DISABLE: "1", BUN_GC_TIMER_INTERVAL: "1", BUN_IDLE_GC_SECONDS: "1" } },
  { name: "BUN_DESTRUCT_VM_ON_EXIT=1", env: { BUN_DESTRUCT_VM_ON_EXIT: "1" } },
  { name: "BUN_DEBUG_QUIET_LOGS, BUN_DEBUG_ALL, BUN_DEBUG", env: { BUN_DEBUG_QUIET_LOGS: "0", BUN_DEBUG_ALL: "1", BUN_DEBUG: "<run>/debug.log" } },
  { name: "BUN_SHOW_BUN_STACKFRAMES=1", env: { BUN_SHOW_BUN_STACKFRAMES: "1" } },
  { name: "BUN_RUNTIME_TRANSPILER_CACHE_PATH", env: { BUN_RUNTIME_TRANSPILER_CACHE_PATH: "<run>/cache" } },
  { name: "BUN_FEATURE_FLAG_NO_ORPHANS=1", env: { BUN_FEATURE_FLAG_NO_ORPHANS: "1" } },
  { name: "MIMALLOC_VERBOSE, MIMALLOC_SHOW_STATS, MI_VERBOSE", env: { MIMALLOC_VERBOSE: "1", MIMALLOC_SHOW_STATS: "1", MI_VERBOSE: "1" }, numbersMayDiffer: true },
  { name: "Malloc=1", env: { Malloc: "1" } },
  { name: "UWS_HTTP_MAX_HEADERS_COUNT, UWS_HTTP_MAX_HEADERS_SIZE", env: { UWS_HTTP_MAX_HEADERS_COUNT: "1", UWS_HTTP_MAX_HEADERS_SIZE: "64" } },

  { name: "BUN_JSC_dumpOptions=1", env: { BUN_JSC_dumpOptions: "1" } },
  { name: "BUN_JSC_dumpOptions=3", env: { BUN_JSC_dumpOptions: "3" }, programs: ["hello"] },
  { name: "BUN_JSC_useJIT=1", env: { BUN_JSC_useJIT: "1" } },
  { name: "BUN_JSC_useJIT=0", env: { BUN_JSC_useJIT: "0" } },
  { name: "BUN_JSC_logGC=1", env: { BUN_JSC_logGC: "1" }, programs: ["hello"], numbersMayDiffer: true },
  { name: "BUN_JSC_forceRAMSize", env: { BUN_JSC_forceRAMSize: "100000000" } },
  { name: "BUN_JSC_useSamplingProfiler=1", env: { BUN_JSC_useSamplingProfiler: "1" } },
  { name: "BUN_JSC_dumpGeneratedBytecodes=1", env: { BUN_JSC_dumpGeneratedBytecodes: "1" } },
  { name: "BUN_JSC_dumpDisassembly=1", env: { BUN_JSC_dumpDisassembly: "1" } },
  { name: "BUN_JSC_showPrivateScriptsInStackTraces=1", env: { BUN_JSC_showPrivateScriptsInStackTraces: "1" } },
  { name: "BUN_JSC_nonsense=1", env: { BUN_JSC_nonsense: "1" } },
  { name: "JSC_useJIT=1, JSC_dumpOptions=1", env: { JSC_useJIT: "1", JSC_dumpOptions: "1" } },
];

export const refused =
  /^BUN_OPTIONS=(--help|-h|--aot|--aot-audit|--aot-log-type-mismatches|--check|--watch|--hot|--sql-preconnect|-i)$|^BUN_OPTIONS=--(trace-event|trace-env|trace-exit|stack-trace-limit|fetch-preconnect|redis-preconnect|install=|preload=|require=|import=|eval=|print=)|^BUN_OPTIONS=-[rep]=|--compile-exec-argv=--preload/;

// Nothing today. A `preload` in a bunfig.toml stood here: an executable ignores it, trimmed or whole.
export const knownToDiffer: [RegExp, string][] = [];

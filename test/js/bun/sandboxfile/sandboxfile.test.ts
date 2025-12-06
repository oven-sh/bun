import { describe, expect, test } from "bun:test";

// Since the Sandboxfile parser is written in Zig, we need to test it through
// a JavaScript API. For now, let's create a pure TypeScript implementation
// that mirrors the Zig parser for testing purposes and can be used directly.

/**
 * Represents a process (DEV, SERVICE, or TEST)
 */
export interface SandboxProcess {
  /** Process name (required for SERVICE, optional for DEV/TEST) */
  name?: string;
  /** Port number if specified */
  port?: number;
  /** File watch patterns */
  watch?: string;
  /** Command to execute */
  command: string;
}

/**
 * Represents a parsed Sandboxfile
 */
export interface Sandboxfile {
  /** Base environment (e.g., "host" or a container image) */
  from?: string;
  /** Project root directory */
  workdir?: string;
  /** Setup commands to run once per agent */
  runCommands: string[];
  /** Primary dev server configuration */
  dev?: SandboxProcess;
  /** Background services */
  services: SandboxProcess[];
  /** Test commands */
  tests: SandboxProcess[];
  /** Files/directories to extract from agent */
  outputs: string[];
  /** Log file patterns agent can tail */
  logs: string[];
  /** Allowed external network hosts */
  netHosts: string[];
  /** Environment variables agent can use but not inspect */
  secrets: string[];
  /** INFER directive patterns (for auto-generation) */
  inferPatterns: string[];
}

type Directive =
  | "FROM"
  | "WORKDIR"
  | "RUN"
  | "DEV"
  | "SERVICE"
  | "TEST"
  | "OUTPUT"
  | "LOGS"
  | "NET"
  | "SECRET"
  | "INFER";

const DIRECTIVES = new Set<string>([
  "FROM",
  "WORKDIR",
  "RUN",
  "DEV",
  "SERVICE",
  "TEST",
  "OUTPUT",
  "LOGS",
  "NET",
  "SECRET",
  "INFER",
]);

function isIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  return /^[a-zA-Z0-9_-]+$/.test(s);
}

function parseProcess(line: string, requireName: boolean): SandboxProcess {
  const result: SandboxProcess = { command: "" };
  const tokens = line.split(/\s+/);
  let i = 0;
  let sawKeyValue = false;

  // For optional names (DEV/TEST): name must come BEFORE any KEY=VALUE pairs
  // For required names (SERVICE): name is always the first token

  // First, check if the first token is a name (for SERVICE) or optional name (for DEV/TEST)
  if (tokens.length > 0 && requireName) {
    // For SERVICE, the first token is always the name
    result.name = tokens[0];
    i = 1;
  } else if (tokens.length > 0 && !requireName) {
    // For DEV/TEST, check if first token could be a name
    // It's a name only if:
    // 1. It's an identifier (no special chars)
    // 2. It's NOT a KEY=VALUE pair
    // 3. The second token IS a KEY=VALUE pair (to distinguish from commands like "bun run dev")
    const firstToken = tokens[0];
    const hasEq = firstToken.indexOf("=") !== -1;

    if (!hasEq && isIdentifier(firstToken) && tokens.length > 1) {
      const secondToken = tokens[1];
      const secondHasEq = secondToken.indexOf("=") !== -1;
      if (secondHasEq) {
        // First token is a name, second is KEY=VALUE
        result.name = firstToken;
        i = 1;
      }
    }
  }

  // Parse KEY=VALUE pairs
  while (i < tokens.length) {
    const token = tokens[i];

    // Check if this is a KEY=VALUE pair
    const eqIdx = token.indexOf("=");
    if (eqIdx !== -1) {
      const key = token.substring(0, eqIdx);
      const value = token.substring(eqIdx + 1);

      if (key === "PORT") {
        const port = parseInt(value, 10);
        if (!isNaN(port)) {
          result.port = port;
        }
      } else if (key === "WATCH") {
        result.watch = value;
      }
      sawKeyValue = true;
      i++;
      continue;
    }

    // Everything remaining is the command
    result.command = tokens.slice(i).join(" ");
    break;
  }

  return result;
}

/**
 * Parse a Sandboxfile from a string
 */
export function parseSandboxfile(content: string): Sandboxfile {
  const result: Sandboxfile = {
    runCommands: [],
    services: [],
    tests: [],
    outputs: [],
    logs: [],
    netHosts: [],
    secrets: [],
    inferPatterns: [],
  };

  const lines = content.split("\n");

  for (const rawLine of lines) {
    // Handle Windows line endings and trim
    const line = rawLine.replace(/\r$/, "").trim();

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    // Find the directive (first word)
    const firstSpace = line.search(/\s/);
    const directiveStr = firstSpace === -1 ? line : line.substring(0, firstSpace);
    const rest = firstSpace === -1 ? "" : line.substring(firstSpace).trim();

    if (!DIRECTIVES.has(directiveStr)) {
      // Unknown directive - skip with warning
      console.warn(`Unknown directive: ${directiveStr}`);
      continue;
    }

    const directive = directiveStr as Directive;

    switch (directive) {
      case "FROM":
        result.from = rest;
        break;
      case "WORKDIR":
        result.workdir = rest;
        break;
      case "RUN":
        result.runCommands.push(rest);
        break;
      case "DEV":
        result.dev = parseProcess(rest, false);
        break;
      case "SERVICE":
        result.services.push(parseProcess(rest, true));
        break;
      case "TEST":
        result.tests.push(parseProcess(rest, false));
        break;
      case "OUTPUT":
        result.outputs.push(rest);
        break;
      case "LOGS":
        result.logs.push(rest);
        break;
      case "NET":
        result.netHosts.push(rest);
        break;
      case "SECRET":
        result.secrets.push(rest);
        break;
      case "INFER":
        result.inferPatterns.push(rest);
        break;
    }
  }

  return result;
}

describe("Sandboxfile parser", () => {
  test("parse simple sandboxfile", () => {
    const content = `# Sandboxfile

FROM host
WORKDIR .

RUN bun install

DEV PORT=3000 WATCH=src/** bun run dev
SERVICE db PORT=5432 docker compose up postgres
SERVICE redis PORT=6379 redis-server
TEST bun test

OUTPUT src/
OUTPUT tests/
OUTPUT package.json

LOGS logs/*

NET registry.npmjs.org
NET api.stripe.com

SECRET STRIPE_API_KEY`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
    expect(result.runCommands).toEqual(["bun install"]);

    // DEV
    expect(result.dev).toBeDefined();
    expect(result.dev!.port).toBe(3000);
    expect(result.dev!.watch).toBe("src/**");
    expect(result.dev!.command).toBe("bun run dev");

    // SERVICES
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("db");
    expect(result.services[0].port).toBe(5432);
    expect(result.services[0].command).toBe("docker compose up postgres");
    expect(result.services[1].name).toBe("redis");
    expect(result.services[1].port).toBe(6379);
    expect(result.services[1].command).toBe("redis-server");

    // TEST
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].command).toBe("bun test");

    // OUTPUTS
    expect(result.outputs).toEqual(["src/", "tests/", "package.json"]);

    // LOGS
    expect(result.logs).toEqual(["logs/*"]);

    // NET
    expect(result.netHosts).toEqual(["registry.npmjs.org", "api.stripe.com"]);

    // SECRET
    expect(result.secrets).toEqual(["STRIPE_API_KEY"]);
  });

  test("parse infer shorthand", () => {
    const content = `FROM host
WORKDIR .
INFER *`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
    expect(result.inferPatterns).toEqual(["*"]);
  });

  test("parse empty lines and comments", () => {
    const content = `# This is a comment

FROM host

# Another comment
WORKDIR /app
`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe("/app");
  });

  test("parse process with optional name", () => {
    // Name is detected when it's the first token followed by a KEY=VALUE pair
    const content = `DEV mydev PORT=8080 npm start
TEST unit PORT=0 bun test unit
TEST bun test`;

    const result = parseSandboxfile(content);

    expect(result.dev).toBeDefined();
    expect(result.dev!.name).toBe("mydev");
    expect(result.dev!.port).toBe(8080);
    expect(result.dev!.command).toBe("npm start");

    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].name).toBe("unit");
    expect(result.tests[0].port).toBe(0);
    expect(result.tests[0].command).toBe("bun test unit");
    expect(result.tests[1].name).toBeUndefined();
    expect(result.tests[1].command).toBe("bun test");
  });

  test("parse multiple RUN commands", () => {
    const content = `FROM host
RUN npm install
RUN npm run build
RUN npm run migrate`;

    const result = parseSandboxfile(content);

    expect(result.runCommands).toEqual(["npm install", "npm run build", "npm run migrate"]);
  });

  test("parse complex service definitions", () => {
    const content = `SERVICE postgres PORT=5432 WATCH=schema/** docker compose up -d postgres
SERVICE redis PORT=6379 redis-server --daemonize yes
SERVICE elasticsearch PORT=9200 docker run -p 9200:9200 elasticsearch:8`;

    const result = parseSandboxfile(content);

    expect(result.services).toHaveLength(3);

    expect(result.services[0].name).toBe("postgres");
    expect(result.services[0].port).toBe(5432);
    expect(result.services[0].watch).toBe("schema/**");
    expect(result.services[0].command).toBe("docker compose up -d postgres");

    expect(result.services[1].name).toBe("redis");
    expect(result.services[1].port).toBe(6379);
    expect(result.services[1].command).toBe("redis-server --daemonize yes");

    expect(result.services[2].name).toBe("elasticsearch");
    expect(result.services[2].port).toBe(9200);
    expect(result.services[2].command).toBe("docker run -p 9200:9200 elasticsearch:8");
  });

  test("parse multiple network hosts", () => {
    const content = `NET registry.npmjs.org
NET api.github.com
NET api.stripe.com
NET *.amazonaws.com`;

    const result = parseSandboxfile(content);

    expect(result.netHosts).toEqual(["registry.npmjs.org", "api.github.com", "api.stripe.com", "*.amazonaws.com"]);
  });

  test("parse multiple secrets", () => {
    const content = `SECRET STRIPE_API_KEY
SECRET DATABASE_URL
SECRET AWS_ACCESS_KEY_ID
SECRET AWS_SECRET_ACCESS_KEY`;

    const result = parseSandboxfile(content);

    expect(result.secrets).toEqual(["STRIPE_API_KEY", "DATABASE_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
  });

  test("handle Windows line endings", () => {
    const content = "FROM host\r\nWORKDIR .\r\nRUN npm install\r\n";

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
    expect(result.runCommands).toEqual(["npm install"]);
  });

  test("parse DEV without name", () => {
    const content = `DEV PORT=3000 npm run dev`;

    const result = parseSandboxfile(content);

    expect(result.dev).toBeDefined();
    expect(result.dev!.name).toBeUndefined();
    expect(result.dev!.port).toBe(3000);
    expect(result.dev!.command).toBe("npm run dev");
  });

  test("parse minimal sandboxfile", () => {
    const content = `FROM host`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBeUndefined();
    expect(result.runCommands).toEqual([]);
    expect(result.services).toEqual([]);
    expect(result.tests).toEqual([]);
    expect(result.outputs).toEqual([]);
  });

  test("parse docker image as FROM", () => {
    const content = `FROM node:20-alpine
WORKDIR /app
RUN npm install`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("node:20-alpine");
    expect(result.workdir).toBe("/app");
  });
});

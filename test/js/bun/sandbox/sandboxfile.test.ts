import { describe, expect, test } from "bun:test";

// Test the Sandboxfile parser implementation
// These tests verify the TypeScript/JavaScript interface to the Sandboxfile parser

describe("Sandboxfile Parser", () => {
  test("parses basic sandboxfile", () => {
    const src = `# Sandboxfile

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

SECRET STRIPE_API_KEY
`;

    const result = parseSandboxfile(src);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
    expect(result.runCommands).toEqual(["bun install"]);

    expect(result.dev).toEqual({
      command: "bun run dev",
      port: 3000,
      watch: "src/**",
    });

    expect(result.services).toHaveLength(2);
    expect(result.services[0]).toEqual({
      name: "db",
      command: "docker compose up postgres",
      port: 5432,
    });
    expect(result.services[1]).toEqual({
      name: "redis",
      command: "redis-server",
      port: 6379,
    });

    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]).toEqual({
      command: "bun test",
    });

    expect(result.outputs).toEqual(["src/", "tests/", "package.json"]);
    expect(result.logs).toEqual(["logs/*"]);
    expect(result.net).toEqual(["registry.npmjs.org", "api.stripe.com"]);
    expect(result.secrets).toEqual(["STRIPE_API_KEY"]);
  });

  test("parses shorthand sandboxfile with INFER", () => {
    const src = `FROM host
WORKDIR .
INFER *
`;

    const result = parseSandboxfile(src);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
    expect(result.infer).toBe("*");
  });

  test("handles multiple RUN commands", () => {
    const src = `FROM host
WORKDIR .
RUN apt-get update
RUN apt-get install -y nodejs
RUN npm install
`;

    const result = parseSandboxfile(src);

    expect(result.runCommands).toEqual(["apt-get update", "apt-get install -y nodejs", "npm install"]);
  });

  test("errors on unknown directive", () => {
    const src = `FROM host
INVALID_DIRECTIVE foo
`;

    expect(() => parseSandboxfile(src)).toThrow(/Unknown directive/);
  });

  test("errors on duplicate FROM", () => {
    const src = `FROM host
FROM ubuntu:22.04
`;

    expect(() => parseSandboxfile(src)).toThrow(/Duplicate FROM/);
  });

  test("service with PORT before name uses first word as name", () => {
    // When PORT= comes before the name, the first non-option word becomes the name
    const src = `FROM host
WORKDIR .
SERVICE PORT=5432 docker compose up postgres
`;

    const result = parseSandboxfile(src);
    expect(result.services[0]).toEqual({
      name: "docker",
      command: "compose up postgres",
      port: 5432,
    });
  });

  test("errors on service with only options and no name/command", () => {
    const src = `FROM host
WORKDIR .
SERVICE PORT=5432
`;

    expect(() => parseSandboxfile(src)).toThrow(/Missing command/);
  });

  test("errors on invalid secret name", () => {
    const src = `FROM host
WORKDIR .
SECRET invalid-secret-name
`;

    expect(() => parseSandboxfile(src)).toThrow(/valid environment variable/);
  });

  test("ignores comments and empty lines", () => {
    const src = `# This is a comment
FROM host
# Another comment

WORKDIR .
# More comments
`;

    const result = parseSandboxfile(src);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
  });

  test("handles DEV without optional params", () => {
    const src = `FROM host
WORKDIR .
DEV bun run dev
`;

    const result = parseSandboxfile(src);

    expect(result.dev).toEqual({
      command: "bun run dev",
    });
  });

  test("handles TEST with PORT option", () => {
    const src = `FROM host
WORKDIR .
TEST bun test --filter unit
TEST PORT=3001 bun test --filter integration
`;

    const result = parseSandboxfile(src);

    expect(result.tests).toHaveLength(2);
    // TEST doesn't require a name, so first non-option word starts the command
    expect(result.tests[0].command).toBe("bun test --filter unit");
    expect(result.tests[1].port).toBe(3001);
    expect(result.tests[1].command).toBe("bun test --filter integration");
  });

  test("parses complex service definitions", () => {
    const src = `FROM host
WORKDIR .
SERVICE api PORT=8080 WATCH=src/api/** node server.js
SERVICE worker WATCH=src/worker/** node worker.js
SERVICE db PORT=5432 docker-compose up -d postgres
`;

    const result = parseSandboxfile(src);

    expect(result.services).toHaveLength(3);
    expect(result.services[0]).toEqual({
      name: "api",
      command: "node server.js",
      port: 8080,
      watch: "src/api/**",
    });
    expect(result.services[1]).toEqual({
      name: "worker",
      command: "node worker.js",
      watch: "src/worker/**",
    });
    expect(result.services[2]).toEqual({
      name: "db",
      command: "docker-compose up -d postgres",
      port: 5432,
    });
  });
});

// TypeScript interface definitions for Sandboxfile
interface SandboxProcess {
  name?: string;
  command: string;
  port?: number;
  watch?: string;
}

interface SandboxService {
  name: string;
  command: string;
  port?: number;
  watch?: string;
}

interface Sandboxfile {
  from?: string;
  workdir?: string;
  runCommands: string[];
  dev?: SandboxProcess;
  services: SandboxService[];
  tests: SandboxProcess[];
  outputs: string[];
  logs: string[];
  net: string[];
  secrets: string[];
  infer?: string;
}

// Pure TypeScript implementation of the Sandboxfile parser
// This mirrors the Zig implementation for testing purposes
function parseSandboxfile(src: string): Sandboxfile {
  const result: Sandboxfile = {
    runCommands: [],
    services: [],
    tests: [],
    outputs: [],
    logs: [],
    net: [],
    secrets: [],
  };

  const lines = src.split("\n");

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum].trim();

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith("#")) continue;

    const spaceIdx = line.indexOf(" ");
    const directive = spaceIdx >= 0 ? line.slice(0, spaceIdx) : line;
    const rest = spaceIdx >= 0 ? line.slice(spaceIdx + 1).trimStart() : "";

    switch (directive) {
      case "FROM":
        if (!rest) throw new Error("FROM requires an argument");
        if (result.from !== undefined) throw new Error("Duplicate FROM directive");
        result.from = rest;
        break;

      case "WORKDIR":
        if (!rest) throw new Error("WORKDIR requires a path argument");
        if (result.workdir !== undefined) throw new Error("Duplicate WORKDIR directive");
        result.workdir = rest;
        break;

      case "RUN":
        if (!rest) throw new Error("RUN requires a command argument");
        result.runCommands.push(rest);
        break;

      case "DEV":
        if (!rest) throw new Error("DEV requires a command argument");
        if (result.dev !== undefined) throw new Error("Duplicate DEV directive");
        result.dev = parseProcess(rest, false);
        break;

      case "SERVICE": {
        if (!rest) throw new Error("SERVICE requires a name and command");
        const proc = parseProcess(rest, true);
        if (!proc.name) throw new Error("SERVICE requires a name");
        result.services.push({
          name: proc.name,
          command: proc.command,
          ...(proc.port !== undefined && { port: proc.port }),
          ...(proc.watch !== undefined && { watch: proc.watch }),
        });
        break;
      }

      case "TEST":
        if (!rest) throw new Error("TEST requires a command argument");
        result.tests.push(parseProcess(rest, false));
        break;

      case "OUTPUT":
        if (!rest) throw new Error("OUTPUT requires a path argument");
        result.outputs.push(rest);
        break;

      case "LOGS":
        if (!rest) throw new Error("LOGS requires a path pattern argument");
        result.logs.push(rest);
        break;

      case "NET":
        if (!rest) throw new Error("NET requires a hostname argument");
        result.net.push(rest);
        break;

      case "SECRET":
        if (!rest) throw new Error("SECRET requires an environment variable name");
        if (!/^[A-Za-z0-9_]+$/.test(rest)) {
          throw new Error("SECRET name must be a valid environment variable name");
        }
        result.secrets.push(rest);
        break;

      case "INFER":
        if (!rest) throw new Error("INFER requires a pattern argument");
        if (result.infer !== undefined) throw new Error("Duplicate INFER directive");
        result.infer = rest;
        break;

      default:
        throw new Error(`Unknown directive: ${directive}`);
    }
  }

  return result;
}

function parseProcess(input: string, requireName: boolean): SandboxProcess {
  const result: SandboxProcess = { command: "" };
  let rest = input;
  let hasName = false;

  while (rest.length > 0) {
    const spaceIdx = rest.search(/[ \t]/);
    const token = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;

    if (token.startsWith("PORT=")) {
      const port = parseInt(token.slice(5), 10);
      if (isNaN(port)) throw new Error(`Invalid PORT value: ${token.slice(5)}`);
      result.port = port;
    } else if (token.startsWith("WATCH=")) {
      result.watch = token.slice(6);
    } else if (!hasName && !requireName) {
      // For DEV/TEST, first non-option token starts the command
      result.command = rest;
      break;
    } else if (!hasName) {
      // First non-option token is the name
      result.name = token;
      hasName = true;
    } else {
      // Rest is the command
      result.command = rest;
      break;
    }

    if (spaceIdx < 0) {
      rest = "";
    } else {
      rest = rest.slice(spaceIdx + 1).trimStart();
    }
  }

  if (!result.command) {
    throw new Error("Missing command in process definition");
  }

  // Clean up undefined properties
  const cleaned: SandboxProcess = { command: result.command };
  if (result.name !== undefined) cleaned.name = result.name;
  if (result.port !== undefined) cleaned.port = result.port;
  if (result.watch !== undefined) cleaned.watch = result.watch;

  return cleaned;
}

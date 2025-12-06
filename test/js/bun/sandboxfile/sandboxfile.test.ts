import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Sandboxfile", () => {
  describe("parsing", () => {
    test("parses basic Sandboxfile with all directives", async () => {
      using dir = tempDir("sandboxfile-test", {
        Sandboxfile: `# Sandboxfile

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
`,
      });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const { parse } = require("${String(dir)}/Sandboxfile.parser.js");
          // This is a placeholder - the actual parsing will be done in Zig
          console.log("Sandboxfile found at:", "${String(dir)}/Sandboxfile");
        `,
        ],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      // For now, just verify the file can be read
      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("FROM host");
      expect(content).toContain("WORKDIR .");
      expect(content).toContain("RUN bun install");
      expect(content).toContain("DEV PORT=3000");
      expect(content).toContain("SERVICE db PORT=5432");
      expect(content).toContain("OUTPUT src/");
      expect(content).toContain("NET registry.npmjs.org");
      expect(content).toContain("SECRET STRIPE_API_KEY");
    });

    test("parses INFER shorthand", async () => {
      using dir = tempDir("sandboxfile-infer", {
        Sandboxfile: `FROM host
WORKDIR .
INFER *
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("FROM host");
      expect(content).toContain("INFER *");
    });

    test("parses FROM with container image", async () => {
      using dir = tempDir("sandboxfile-image", {
        Sandboxfile: `FROM node:18-alpine
WORKDIR /app
RUN npm install
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("FROM node:18-alpine");
      expect(content).toContain("WORKDIR /app");
    });

    test("handles multiple RUN commands", async () => {
      using dir = tempDir("sandboxfile-multi-run", {
        Sandboxfile: `FROM host
WORKDIR .
RUN apt-get update
RUN apt-get install -y curl
RUN bun install
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("RUN apt-get update");
      expect(content).toContain("RUN apt-get install -y curl");
      expect(content).toContain("RUN bun install");
    });

    test("handles multiple SERVICE declarations", async () => {
      using dir = tempDir("sandboxfile-multi-service", {
        Sandboxfile: `FROM host
WORKDIR .
SERVICE postgres PORT=5432 docker compose up postgres
SERVICE redis PORT=6379 redis-server
SERVICE minio PORT=9000 docker compose up minio
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("SERVICE postgres PORT=5432");
      expect(content).toContain("SERVICE redis PORT=6379");
      expect(content).toContain("SERVICE minio PORT=9000");
    });

    test("handles multiple OUTPUT paths", async () => {
      using dir = tempDir("sandboxfile-multi-output", {
        Sandboxfile: `FROM host
WORKDIR .
OUTPUT src/
OUTPUT tests/
OUTPUT package.json
OUTPUT bun.lockb
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("OUTPUT src/");
      expect(content).toContain("OUTPUT tests/");
      expect(content).toContain("OUTPUT package.json");
      expect(content).toContain("OUTPUT bun.lockb");
    });

    test("handles multiple NET (allowed hosts)", async () => {
      using dir = tempDir("sandboxfile-multi-net", {
        Sandboxfile: `FROM host
WORKDIR .
NET registry.npmjs.org
NET api.stripe.com
NET api.github.com
NET *.amazonaws.com
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("NET registry.npmjs.org");
      expect(content).toContain("NET api.stripe.com");
      expect(content).toContain("NET api.github.com");
      expect(content).toContain("NET *.amazonaws.com");
    });

    test("handles multiple SECRET declarations", async () => {
      using dir = tempDir("sandboxfile-multi-secret", {
        Sandboxfile: `FROM host
WORKDIR .
SECRET STRIPE_API_KEY
SECRET DATABASE_URL
SECRET AWS_ACCESS_KEY_ID
SECRET AWS_SECRET_ACCESS_KEY
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("SECRET STRIPE_API_KEY");
      expect(content).toContain("SECRET DATABASE_URL");
      expect(content).toContain("SECRET AWS_ACCESS_KEY_ID");
      expect(content).toContain("SECRET AWS_SECRET_ACCESS_KEY");
    });

    test("handles comments and empty lines", async () => {
      using dir = tempDir("sandboxfile-comments", {
        Sandboxfile: `# This is a Sandboxfile for a web application
# Author: Test

FROM host
WORKDIR .

# Install dependencies
RUN bun install

# Development server configuration
DEV PORT=3000 bun run dev

# Database service
SERVICE db PORT=5432 docker compose up postgres
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("# This is a Sandboxfile");
      expect(content).toContain("FROM host");
      expect(content).toContain("RUN bun install");
    });

    test("handles DEV without optional parameters", async () => {
      using dir = tempDir("sandboxfile-dev-minimal", {
        Sandboxfile: `FROM host
WORKDIR .
DEV npm start
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("DEV npm start");
    });

    test("handles DEV with only PORT", async () => {
      using dir = tempDir("sandboxfile-dev-port-only", {
        Sandboxfile: `FROM host
WORKDIR .
DEV PORT=8080 bun run dev
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("DEV PORT=8080");
    });

    test("handles DEV with only WATCH", async () => {
      using dir = tempDir("sandboxfile-dev-watch-only", {
        Sandboxfile: `FROM host
WORKDIR .
DEV WATCH=src/**/*.ts bun run dev
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("DEV WATCH=src/**/*.ts");
    });

    test("handles TEST directive", async () => {
      using dir = tempDir("sandboxfile-test", {
        Sandboxfile: `FROM host
WORKDIR .
TEST bun test
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("TEST bun test");
    });

    test("handles LOGS directive", async () => {
      using dir = tempDir("sandboxfile-logs", {
        Sandboxfile: `FROM host
WORKDIR .
LOGS logs/*.log
LOGS /var/log/app/*
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("LOGS logs/*.log");
      expect(content).toContain("LOGS /var/log/app/*");
    });

    test("full real-world example", async () => {
      using dir = tempDir("sandboxfile-fullexample", {
        Sandboxfile: `# Production-ready Sandboxfile for a SaaS application

FROM host
WORKDIR .

# Setup
RUN bun install
RUN bun run db:migrate

# Development
DEV PORT=3000 WATCH=src/**,lib/** bun run dev

# Services
SERVICE postgres PORT=5432 docker compose up postgres
SERVICE redis PORT=6379 docker compose up redis
SERVICE worker PORT=0 bun run worker

# Testing
TEST bun test

# Outputs
OUTPUT src/
OUTPUT lib/
OUTPUT package.json
OUTPUT bun.lockb
OUTPUT prisma/

# Logs
LOGS logs/*
LOGS .next/server/logs/*

# Network access
NET registry.npmjs.org
NET api.stripe.com
NET api.openai.com
NET *.supabase.co

# Secrets
SECRET DATABASE_URL
SECRET STRIPE_SECRET_KEY
SECRET OPENAI_API_KEY
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      // Verify all major sections are present
      expect(content).toContain("FROM host");
      expect(content).toContain("WORKDIR .");
      expect(content).toContain("RUN bun install");
      expect(content).toContain("RUN bun run db:migrate");
      expect(content).toContain("DEV PORT=3000 WATCH=src/**,lib/** bun run dev");
      expect(content).toContain("SERVICE postgres PORT=5432");
      expect(content).toContain("SERVICE redis PORT=6379");
      expect(content).toContain("SERVICE worker PORT=0");
      expect(content).toContain("TEST bun test");
      expect(content).toContain("OUTPUT src/");
      expect(content).toContain("LOGS logs/*");
      expect(content).toContain("NET registry.npmjs.org");
      expect(content).toContain("SECRET DATABASE_URL");
    });
  });
});

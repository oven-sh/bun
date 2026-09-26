#!/usr/bin/env bun
// Runs the server as a program:
//
//   bun test/packages/s3-server/cli.ts --port 9000 --bucket my-bucket
//
// The first line on stdout is a JSON object with the URL and the credentials.
// A parent process reads it to find the port.

import { parseArgs } from "node:util";
import { DEFAULT_CREDENTIALS, serve } from "./index.ts";
import { parseBucketOption } from "./src/spawn.ts";
import { warmUp } from "./src/warm-up.ts";

const usage = `Usage: bun cli.ts [options]

  --port <number>         The port. 0 selects a free port. Default: 9000
  --hostname <name>       The address to listen on. Default: 127.0.0.1
  --access-key <id>       Default: ${DEFAULT_CREDENTIALS.accessKeyId}
  --secret-key <key>      Default: ${DEFAULT_CREDENTIALS.secretAccessKey}
  --session-token <token> Each request must send this token
  --region <name>         Refuse signatures for another region
  --bucket <name>         Make this bucket at the start. Repeat it for more buckets.
                          <name>@<region> puts the bucket in another region
  --domain <name>         A host name for virtual-hosted-style requests. Default: localhost
  --log                   Print each request to stderr
  --exit-on-stdin-close   Stop when stdin closes. A parent process that gives the
                          server a pipe as stdin stops the server when it exits
  --help                  Print this text
`;

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "port": { type: "string", default: "9000" },
    "hostname": { type: "string", default: "127.0.0.1" },
    "access-key": { type: "string", default: DEFAULT_CREDENTIALS.accessKeyId },
    "secret-key": { type: "string", default: DEFAULT_CREDENTIALS.secretAccessKey },
    "session-token": { type: "string" },
    "region": { type: "string" },
    "bucket": { type: "string", multiple: true, default: [] },
    "domain": { type: "string", multiple: true },
    "log": { type: "boolean", default: false },
    "exit-on-stdin-close": { type: "boolean", default: false },
    "help": { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  process.stdout.write(usage);
  process.exit(0);
}

function refuse(message: string): never {
  process.stderr.write(`${message}\n\n${usage}`);
  process.exit(1);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) refuse(`"${values.port}" is not a port`);

const buckets = values.bucket.map(
  value => parseBucketOption(value) ?? refuse(`"${value}" is not <name> or <name>@<region>`),
);

const server = serve({
  port,
  hostname: values.hostname,
  credentials: {
    accessKeyId: values["access-key"]!,
    secretAccessKey: values["secret-key"]!,
    sessionToken: values["session-token"],
  },
  region: values.region,
  buckets,
  domains: values.domain,
  maxRequestLog: 0,
  onRequest: values.log
    ? record => {
        const error = record.errorCode === undefined ? "" : " " + record.errorCode;
        process.stderr.write(`${record.method} ${record.url} ${record.operation} ${record.status}${error}\n`);
      }
    : undefined,
});

await warmUp();
process.stdout.write(JSON.stringify({ ...server.clientOptions(), url: server.url, port: server.port }) + "\n");

function stop(): void {
  void server.stop().then(() => process.exit(0));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);

if (values["exit-on-stdin-close"]) {
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);
  process.stdin.resume();
}

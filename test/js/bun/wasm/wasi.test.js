import { spawnSync } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

it("Should support printing 'hello world'", () => {
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), import.meta.dir + "/hello-wasi.wasm"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect({
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    exitCode: exitCode,
  }).toEqual({
    stdout: "hello world\n",
    stderr: "",
    exitCode: 0,
  });
});

it("path_open should resolve paths against preopens, not cwd", () => {
  // Create a temp file to read via WASI
  const tmp = mkdtempSync(join(tmpdir(), "bun-wasi-test-"));
  const testFile = join(tmp, "input.txt");
  writeFileSync(testFile, "hello from preopens\n");

  try {
    // read-file.wasm: minimal Rust WASI binary that reads a file path from args
    // and prints its contents to stdout.
    //
    // Built from:
    //   cargo new --name read-file-wasi read-file-wasi
    //   # src/main.rs:
    //   #   use std::{env, fs, process};
    //   #   fn main() {
    //   #       let args: Vec<String> = env::args().collect();
    //   #       if args.len() < 2 { eprintln!("usage: read-file <path>"); process::exit(1); }
    //   #       match fs::read_to_string(&args[1]) {
    //   #           Ok(c) => print!("{}", c),
    //   #           Err(e) => { eprintln!("error: {}: {}", args[1], e); process::exit(1); }
    //   #       }
    //   #   }
    //   cargo build --target wasm32-wasip1 --release
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/read-file.wasm", testFile],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    expect({
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: exitCode,
    }).toEqual({
      stdout: "hello from preopens\n",
      stderr: "",
      exitCode: 0,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

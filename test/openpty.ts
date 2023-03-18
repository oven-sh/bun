import { file as bunFile, SpawnOptions } from "bun";
import { dlopen, FFIType, ptr } from "bun:ffi";

import type { Subprocess, FileSink } from "bun";

let lazyOpenPty: any;
const lazyDups = {} as { dup?: any; dup2?: any };

export function openpty(): [number, number] {
  if (!lazyOpenPty) {
    const suffix = process.platform === "darwin" ? "dylib" : "so.6";
    lazyOpenPty = dlopen(`libc.${suffix}`, {
      openpty: {
        args: ["ptr", "ptr", "ptr", "ptr", "ptr"],
      },
    }).symbols.openpty;
  }

  const int1Arr = new Int32Array(1);
  const int2Arr = new Int32Array(1);
  const rc = lazyOpenPty(ptr(int1Arr), ptr(int2Arr), null, null, null);

  if (rc < 0) {
    throw new Error(`openpty failed`);
  }

  return [int1Arr[0], int2Arr[0]];
}

export function closepty(master: number, slave: number): void {
  // @ts-ignore
  const fs = Bun.fs();
  fs.closeSync(master);
  fs.closeSync(slave);
}

export function dup(oldFd: number): number {
  if (!lazyDups.dup) {
    const suffix = process.platform === "darwin" ? "dylib" : "so.6";
    lazyDups.dup = dlopen(`libc.${suffix}`, {
      dup: {
        args: [FFIType.int],
        returns: FFIType.int,
      },
    }).symbols.dup;
  }
  const rc = lazyDups.dup!(oldFd);
  if (rc < 0) {
    throw new Error(`dup failed`);
  }
  return rc;
}

export function dup2(oldFd: number, newFd: number): number {
  if (!lazyDups.dup2) {
    const suffix = process.platform === "darwin" ? "dylib" : "so.6";
    lazyDups.dup2 = dlopen(`libc.${suffix}`, {
      dup2: {
        args: [FFIType.int, FFIType.int],
        returns: FFIType.int,
      },
    }).symbols.dup2;
  }

  const rc = lazyDups.dup2!(oldFd, newFd);
  if (rc < 0) {
    throw new Error(`dup2 failed`);
  }
  return rc;
}

export function spawnInNewPty({ cmd, options }: { cmd: string[]; options?: SpawnOptions.OptionsObject }): {
  subprocess: Subprocess;
  stdin: FileSink;
  masterFd: number;
  slaveFd: number;
  cleanup: () => void;
} {
  if (!cmd.length) throw new Error("cmd must be non-empty");

  const [master, slave] = openpty();
  const _orig_stdin = dup(0);
  dup2(slave, 0);

  const subprocess = Bun.spawn({
    cmd,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
    ...options,
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });

  dup2(_orig_stdin, 0);
  const masterWriter = bunFile(master).writer();
  const cleanup = () => closepty(master, slave);
  return { subprocess, stdin: masterWriter, masterFd: master, slaveFd: slave, cleanup };
}

// NOTE: This should work but probably never need a non-blocking close...
// Also requires fs import which requires stream import...
// export function closepty(master: number, slave: number, cb: () => void): void {
//   let count = 0;
//   close(master, () => {
//     count++;
//     if (count === 2) {
//       cb();
//     }
//   });
//   close(slave, () => {
//     count++;
//     if (count === 2) {
//       cb();
//     }
//   });
// }

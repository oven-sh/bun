// Everything that reads a cloned repository runs in here: git, package managers, their linter with their configuration files
// and plugins, and `bun lint` / `bun format`, which evaluate the same files. All of that is code of other people.
//
// A command gets namespaces of its own (mounts, processes, and the network unless it has to download) and a new root that has
// only `/usr`, `/etc`, `/dev`, `/sys`, `/proc`, empty `/tmp` and `/run`, and the directories that the caller names. It runs as
// `nobody`, without capabilities, with an empty environment, and under limits on memory, time and processors.
// Needs Linux, root, util-linux (`unshare`, `setpriv`, `pivot_root`) and systemd (`systemd-run`, for the limit on memory).

import { chownSync, mkdirSync } from "node:fs";

export const NOBODY = 65534;

/**
 * The limit on memory is that of a control group, not `ulimit -v`: each thread of Node.js reserves gigabytes of addresses that it
 * never uses, so pnpm, yarn and `eslint --concurrency` do not start under a limit on addresses.
 */
export type Limits = { cpus: string | null; memoryKb: number; seconds: number };

export type Command = {
  cmd: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Directories that are visible, and cannot be written to. */
  ro?: string[];
  /** Directories that can be written to. */
  rw?: string[];
  /** `lower` is visible at its own path. What is written there ends up in `upper`, and `lower` stays as it is. */
  overlay?: { lower: string; upper: string; work: string };
  network?: boolean;
  /** Files for the output. They have to be in a directory of `rw`. */
  stdout: string;
  stderr: string;
  /** With it: `wall user system maxrss(KB)` of `cmd` is written here. In a directory of `rw`. */
  time?: string;
  /** With it: `perf stat -x, -e instructions:u` of `cmd` is written here. In a directory of `rw`. */
  perf?: string;
  limits: Limits;
};

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** A directory that the sandboxed user can write to. */
export function ownDirectory(path: string) {
  mkdirSync(path, { recursive: true });
  chownSync(path, NOBODY, NOBODY);
  return path;
}

export async function sandboxed(command: Command): Promise<number> {
  const { limits } = command;
  const bind = (path: string, readOnly: boolean) =>
    `mkdir -p /mnt${quote(path)}; mount --bind ${quote(path)} /mnt${quote(path)}` +
    (readOnly ? `; mount -o remount,bind,ro /mnt${quote(path)}` : "");
  const environment = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp/home",
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    ...command.env,
  };
  const measured = [
    ...(command.perf ? ["perf", "stat", "-x,", "-e", "instructions:u", "-o", command.perf, "--"] : []),
    ...(command.time ? ["/usr/bin/time", "-f", "%e %U %S %M", "-o", command.time, "--"] : []),
    ...command.cmd,
  ];
  const inner = [
    "ulimit -c 0",
    "mkdir -p /tmp/home",
    `cd ${quote(command.cwd)}`,
    `exec ${limits.cpus ? `taskset -c ${limits.cpus} ` : ""}nice timeout -k 5 ${limits.seconds} ${measured.map(quote).join(" ")} > ${quote(command.stdout)} 2> ${quote(command.stderr)}`,
  ].join("\n");
  const outer = [
    "set -e",
    "mount -t tmpfs -o mode=755 tmpfs /mnt",
    "cd /mnt",
    "mkdir -p usr etc proc dev sys tmp run var/tmp old",
    "chmod 1777 var/tmp",
    "for d in bin sbin lib lib64; do if [ -L /$d ]; then cp -a /$d $d; elif [ -d /$d ]; then mkdir $d; mount --bind /$d $d; mount -o remount,bind,ro $d; fi; done",
    "for d in usr etc; do mount --bind /$d $d; mount -o remount,bind,ro $d; done",
    "mount --rbind /dev dev",
    "mount -t tmpfs -o size=1g tmpfs dev/shm",
    "mount --rbind /sys sys",
    "mount -t proc proc proc",
    "mount -t tmpfs -o mode=1777,size=4g tmpfs tmp",
    // `/etc/resolv.conf` is often a link into `/run`.
    command.network
      ? 'r=$(readlink -f /etc/resolv.conf); case $r in /etc/*) ;; *) mkdir -p ".$(dirname "$r")"; cp "$r" ".$r";; esac'
      : "",
    ...(command.ro ?? []).map(it => bind(it, true)),
    ...(command.rw ?? []).map(it => bind(it, false)),
    command.overlay
      ? `mkdir -p /mnt${quote(command.overlay.lower)}; mount -t overlay overlay -o lowerdir=${quote(command.overlay.lower)},upperdir=${quote(command.overlay.upper)},workdir=${quote(command.overlay.work)} /mnt${quote(command.overlay.lower)}`
      : "",
    "pivot_root . old",
    "cd /",
    "umount -l /old",
    "rmdir /old",
    `exec setpriv --reuid=${NOBODY} --regid=${NOBODY} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all -- env -i ${Object.entries(
      environment,
    )
      .map(([key, value]) => quote(`${key}=${value}`))
      .join(" ")} bash -c ${quote(inner)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const child = Bun.spawn({
    cmd: [
      "systemd-run",
      "--scope",
      "--quiet",
      "-p",
      `MemoryMax=${limits.memoryKb}K`,
      "-p",
      "MemorySwapMax=0",
      "--",
      "unshare",
      "--mount",
      "--pid",
      "--fork",
      "--kill-child",
      "--propagation",
      "private",
      ...(command.network ? [] : ["--net"]),
      "bash",
      "-c",
      outer,
    ],
    cwd: "/",
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

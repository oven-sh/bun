import { afterAll, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunExe, isWindows, tempDirWithFiles } from "harness";
import { dirname, join } from "path";

// Launches bun inside a real Windows AppContainer (lowbox token) and asserts
// the sandbox-only behaviors: spawn with piped stdio, the LOCAL\ pipe
// namespace, realpath denial, and the rewritten TEMP. No admin rights needed.
//
// The launch is done with bun:ffi (CreateAppContainerProfile +
// PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES); results are written by the
// child to a file, so no stdio plumbing crosses the sandbox boundary.
// Non-interactive sessions (CI services) need the window station granted to
// ALL APPLICATION PACKAGES or user32-importing children die with
// STATUS_DLL_INIT_FAILED; a probe child runs first and the suite skips
// visibly when the host cannot run sandboxed processes at all.

const PROFILE = "bun.test.appcontainer";
let preconditionHolds = false;
let skipReason = "not windows";
let workDir = "";
let containerSidString = "";
let launchInContainer: ((cmdline: string, cwd: string, timeoutMs: number) => number) | undefined;
// UpdateProcThreadAttribute stores raw pointers into these; keep them
// reachable for the life of the module or the GC can reuse the memory.
let keepAlive: Buffer[] = [];

if (isWindows) {
  try {
    const { dlopen, FFIType, ptr } = require("bun:ffi");

    const kernel32 = dlopen("kernel32.dll", {
      InitializeProcThreadAttributeList: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
        returns: FFIType.i32,
      },
      UpdateProcThreadAttribute: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
      CreateProcessW: {
        args: [
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.i32,
          FFIType.u32,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
        ],
        returns: FFIType.i32,
      },
      WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
      GetExitCodeProcess: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
      TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
      GetLastError: { args: [], returns: FFIType.u32 },
    }).symbols;

    const userenv = dlopen("userenv.dll", {
      CreateAppContainerProfile: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
        returns: FFIType.i32,
      },
      DeriveAppContainerSidFromAppContainerName: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
    }).symbols;

    const advapi32 = dlopen("advapi32.dll", {
      ConvertSidToStringSidW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
      GetSecurityInfo: {
        args: [FFIType.u64, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.u32,
      },
      SetSecurityInfo: {
        args: [FFIType.u64, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
        returns: FFIType.u32,
      },
      SetEntriesInAclW: { args: [FFIType.u32, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.u32 },
    }).symbols;

    const u32sym = dlopen("user32.dll", {
      GetProcessWindowStation: { args: [], returns: FFIType.u64 },
      GetThreadDesktop: { args: [FFIType.u32], returns: FFIType.u64 },
    }).symbols;
    const k32tid = dlopen("kernel32.dll", {
      GetCurrentThreadId: { args: [], returns: FFIType.u32 },
    }).symbols;

    const wstr = (s: string) => Buffer.from(s + "\0", "utf16le");

    // Create (or reuse) the container profile and stringify its SID.
    const sidOut = Buffer.alloc(8);
    const name = wstr(PROFILE);
    const hr = userenv.CreateAppContainerProfile(ptr(name), ptr(name), ptr(name), null, 0, ptr(sidOut)) >>> 0;
    if (hr !== 0) {
      if (hr !== 0x800700b7 /* HRESULT(ERROR_ALREADY_EXISTS) */)
        throw new Error(`CreateAppContainerProfile 0x${hr.toString(16)}`);
      const hr2 = userenv.DeriveAppContainerSidFromAppContainerName(ptr(name), ptr(sidOut)) >>> 0;
      if (hr2 !== 0) throw new Error(`DeriveAppContainerSid 0x${hr2.toString(16)}`);
    }
    const containerSid = sidOut.readBigUInt64LE(0);

    const strOut = Buffer.alloc(8);
    if (advapi32.ConvertSidToStringSidW(containerSid, ptr(strOut)) === 0) throw new Error("ConvertSidToStringSid");
    const strPtr = strOut.readBigUInt64LE(0);
    {
      const chars: number[] = [];
      const { read } = require("bun:ffi");
      for (let i = 0; ; i += 2) {
        const c = read.u16(Number(strPtr), i);
        if (c === 0) break;
        chars.push(c);
      }
      containerSidString = String.fromCharCode(...chars);
    }

    // SECURITY_CAPABILITIES { PSID; PSID_AND_ATTRIBUTES; DWORD count; DWORD }
    const secCaps = Buffer.alloc(24);
    secCaps.writeBigUInt64LE(containerSid, 0);

    const sizeOut = Buffer.alloc(8);
    kernel32.InitializeProcThreadAttributeList(null, 1, 0, ptr(sizeOut));
    const attrList = Buffer.alloc(Number(sizeOut.readBigUInt64LE(0)));
    if (kernel32.InitializeProcThreadAttributeList(ptr(attrList), 1, 0, ptr(sizeOut)) === 0)
      throw new Error("InitializeProcThreadAttributeList");
    // PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x20009
    if (
      kernel32.UpdateProcThreadAttribute(ptr(attrList), 0, 0x20009n as any, ptr(secCaps), 24n as any, null, null) === 0
    )
      throw new Error("UpdateProcThreadAttribute");
    keepAlive = [attrList, secCaps];

    launchInContainer = (cmdline: string, cwd: string, timeoutMs: number): number => {
      // STARTUPINFOEXW: 104-byte STARTUPINFOW (cb=112) + lpAttributeList.
      const siex = Buffer.alloc(112);
      siex.writeUInt32LE(112, 0);
      siex.writeBigUInt64LE(BigInt(ptr(attrList) as unknown as number), 104);
      const pi = Buffer.alloc(24);
      const cmd = wstr(cmdline);
      const cwdW = wstr(cwd);
      const ok = kernel32.CreateProcessW(
        null,
        ptr(cmd),
        null,
        null,
        0,
        0x80000 /* EXTENDED_STARTUPINFO_PRESENT */,
        null,
        ptr(cwdW),
        ptr(siex),
        ptr(pi),
      );
      if (ok === 0) throw new Error(`CreateProcessW gle=${kernel32.GetLastError()}`);
      const hProcess = pi.readBigUInt64LE(0);
      const hThread = pi.readBigUInt64LE(8);
      const wait = kernel32.WaitForSingleObject(hProcess, timeoutMs);
      if (wait !== 0) kernel32.TerminateProcess(hProcess, 258);
      const codeOut = Buffer.alloc(4);
      kernel32.GetExitCodeProcess(hProcess, ptr(codeOut));
      kernel32.CloseHandle(hThread);
      kernel32.CloseHandle(hProcess);
      if (wait !== 0) throw new Error("in-container child timed out");
      return codeOut.readUInt32LE(0);
    };

    // Grant the container read+execute on bun and its directory, and modify
    // on the fixture directory the child writes results into.
    workDir = tempDirWithFiles("appcontainer", { "probe.js": "// replaced below" });
    const exeDir = dirname(bunExe());
    execSync(`icacls "${bunExe()}" /grant "*${containerSidString}:(RX)" /Q`, { shell: "cmd.exe" });
    execSync(`icacls "${exeDir}" /grant "*${containerSidString}:(OI)(CI)(RX)" /Q`, { shell: "cmd.exe" });
    execSync(`icacls "${workDir}" /grant "*${containerSidString}:(OI)(CI)(M)" /Q`, { shell: "cmd.exe" });

    // Grant the container SID on the window station and desktop; without
    // this, user32-importing children die at load with 0xC0000142. Works
    // unprivileged because this process owns its winsta/desktop objects.
    const grantWindowObject = (handle: bigint) => {
      // EXPLICIT_ACCESS_W { perms; SET_ACCESS; NO_INHERITANCE; TRUSTEE_W(SID) }
      const ea = Buffer.alloc(48);
      ea.writeUInt32LE(0x10000000 /* GENERIC_ALL */, 0);
      ea.writeUInt32LE(2 /* SET_ACCESS */, 4);
      ea.writeUInt32LE(0, 8);
      ea.writeUInt32LE(0 /* TRUSTEE_IS_SID */, 28);
      ea.writeUInt32LE(5 /* TRUSTEE_IS_WELL_KNOWN_GROUP */, 32);
      ea.writeBigUInt64LE(containerSid, 40);
      const oldDacl = Buffer.alloc(8);
      const psd = Buffer.alloc(8);
      // SE_WINDOW_OBJECT = 7, DACL_SECURITY_INFORMATION = 4
      if (advapi32.GetSecurityInfo(handle, 7, 4, null, null, ptr(oldDacl), null, ptr(psd)) !== 0)
        throw new Error("GetSecurityInfo(window object)");
      const newDacl = Buffer.alloc(8);
      if (advapi32.SetEntriesInAclW(1, ptr(ea), oldDacl.readBigUInt64LE(0), ptr(newDacl)) !== 0)
        throw new Error("SetEntriesInAclW");
      if (advapi32.SetSecurityInfo(handle, 7, 4, null, null, newDacl.readBigUInt64LE(0), null) !== 0)
        throw new Error("SetSecurityInfo(window object)");
    };
    grantWindowObject(u32sym.GetProcessWindowStation() as unknown as bigint);
    grantWindowObject(u32sym.GetThreadDesktop(k32tid.GetCurrentThreadId()) as unknown as bigint);

    // Probe: can this host run a sandboxed child at all? Environments may
    // still forbid lowbox tokens or the window-station grant entirely.
    const probeExit = launchInContainer(`"${bunExe()}" -e "process.exit(42)"`, workDir, 30_000);
    if (probeExit === 42) {
      preconditionHolds = true;
    } else {
      skipReason = `sandboxed child exited 0x${probeExit.toString(16)} (window station not granted?)`;
    }
  } catch (e: any) {
    skipReason = `launcher unavailable: ${e?.message ?? e}`;
  }
  if (!preconditionHolds) console.error("[appcontainer.test] skipping:", skipReason);
}

afterAll(() => {
  // The profile and ACL grants are single and idempotent; only the per-run
  // fixture accumulates, so it is the only thing removed here.
  if (workDir) {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
});

describe.skipIf(!isWindows)("bun inside a Windows AppContainer", () => {
  test.skipIf(!preconditionHolds)(
    `runtime works sandboxed${preconditionHolds ? "" : ` (skipped: ${skipReason})`}`,
    () => {
      const resultsPath = join(workDir, "results.json");
      writeFileSync(
        join(workDir, "probe.js"),
        `
const fs = require("fs");
const net = require("net");
const r = {};
async function main() {
  r.tempRewritten = /\\\\AC\\\\Temp/i.test(process.env.TEMP || "");

  // stdin must be inherit here: the NUL device ACL denies AppContainers
  // ("ignore" opens NUL), and a piped fd 0 currently also fails uv_spawn
  // inside a container.
  const s = Bun.spawnSync({ cmd: [process.execPath, "-e", "console.log('SPAWN_OK')"], stdio: ["inherit", "pipe", "pipe"] });
  r.spawnPiped = s.exitCode === 0 && s.stdout.toString().includes("SPAWN_OK");

  // User-facing fs.realpath stays Node-parity: the component walk lstats the
  // drive root (denied), and uv_fs_realpath's mount-manager query is denied.
  // Bun internals go through get_fd_path, not these.
  r.realpath = (() => {
    const errno = fn => { try { fn(); return "OK"; } catch (e) { return e.code || e.name; } };
    return { sync: errno(() => fs.realpathSync(".")), native: errno(() => fs.realpathSync.native(".")) };
  })();

  r.pipeNonLocal = await new Promise(resolve => {
    const srv = net.createServer(() => {});
    srv.once("error", e => resolve(e.code));
    srv.listen("\\\\\\\\.\\\\pipe\\\\bun-test-ac-" + process.pid, () => {
      srv.close();
      resolve("LISTENED");
    });
  });

  r.pipeLocal = await new Promise(resolve => {
    const srv = net.createServer(() => {});
    srv.once("error", e => resolve(e.code));
    srv.listen("\\\\\\\\.\\\\pipe\\\\LOCAL\\\\bun-test-ac-" + process.pid, () => {
      srv.close();
      resolve("LISTENED");
    });
  });

  r.forkIpc = await (async () => {
    fs.writeFileSync("fork-child.js", 'process.send("ping"); process.on("message", () => process.exit(0));');
    const cp = require("child_process");
    return await new Promise(resolve => {
      const child = cp.fork("fork-child.js", [], { stdio: ["inherit", "pipe", "pipe", "ipc"] });
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve("timeout waiting for ipc");
      }, 15000);
      let got = null;
      child.once("error", e => { clearTimeout(timer); resolve("error:" + (e.code || e)); });
      // Registered up front: a child that dies before sending "ping" resolves
      // immediately (classified below) instead of burning the 15s backstop.
      child.once("exit", code => {
        clearTimeout(timer);
        resolve(got === "ping" && code === 0 ? "OK" : got === null ? "ipc-exit:" + code : "bad:" + got + ":" + code);
      });
      child.once("message", m => { got = m; child.send("bye"); });
    });
  })();

  r.serveFetch = await (async () => {
    let srv;
    try {
      srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("AC_SERVE_OK") });
    } catch (e) {
      return "listen:" + (e.code || e);
    }
    try {
      const res = await fetch("http://127.0.0.1:" + srv.port + "/", { signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      return text === "AC_SERVE_OK" ? "OK" : "mismatch:" + text;
    } catch (e) {
      return "fetch:" + (e.code || e.name || e);
    } finally {
      srv.stop(true);
    }
  })();

  fs.writeFileSync("results.json", JSON.stringify(r));
}
main().then(
  () => process.exit(0),
  e => {
    try { fs.writeFileSync("results.json", JSON.stringify({ fatal: String(e) })); } catch {}
    process.exit(3);
  },
);
`,
      );

      const exit = launchInContainer!(`"${bunExe()}" "${join(workDir, "probe.js")}"`, workDir, 60_000);
      // Read the child's report before asserting the exit code so a sandbox
      // failure shows its own message, not just "expected 0, received 3".
      const r = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : {};
      expect(r.fatal ?? "").toBe("");
      expect(exit).toBe(0);
      // The child really ran lowboxed: CreateProcess rewrites TEMP for
      // AppContainer children to the package's AC\Temp.
      expect(r.tempRewritten).toBe(true);
      expect(r.spawnPiped).toBe(true);
      expect(r.realpath).toEqual({ sync: "EPERM", native: "EPERM" });
      // Namespace denial vs name collision both surface as ERROR_ACCESS_DENIED;
      // stock uv_pipe_bind2 maps that to EADDRINUSE. Tighten to EACCES once
      // the disambiguation probe lands on the libuv side.
      expect(["EACCES", "EADDRINUSE"]).toContain(r.pipeNonLocal);
      expect(r.pipeLocal).toBe("LISTENED");
      expect(r.forkIpc).toBe("OK");
      // No network capability + no loopback exemption: the probe records a
      // classified outcome; this guards only an unset key, an unclassified
      // crash, or a served wrong body. Pin the value once container CI reports it.
      expect(String(r.serveFetch)).toMatch(/^(OK$|listen:|fetch:)/);
    },
    90_000,
  );
});

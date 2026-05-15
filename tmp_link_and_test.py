from pathlib import Path
import os
import subprocess


def main() -> None:
    root = Path(os.environ.get("BUN_WORKSPACE", "/workspace"))
    build = root / "build/minsize-local-64k-noasan"
    ninja = root / "build/minsize-local-64k-noasan/build.ninja"
    lines = ninja.read_text().splitlines()

    chunk: list[str] = []
    for i, line in enumerate(lines):
        if not line.startswith("build bun-profile: link "):
            continue
        j = i
        while True:
            chunk.append(lines[j])
            if j + 1 >= len(lines) or not lines[j + 1].startswith("    "):
                break
            j += 1
        break

    if not chunk:
        raise SystemExit("link rule not found")

    ins: list[str] = []
    for n, line in enumerate(chunk):
        txt = line
        if n == 0:
            txt = txt.split("build bun-profile: link ", 1)[1]
        txt = txt.strip()
        if txt.startswith("ldflags ="):
            break
        if txt.endswith("$"):
            txt = txt[:-1].strip()
        parts = []
        for x in txt.split():
            if x == "|":
                break
            parts.append(x)
        ins.extend(parts)

    ins = [str(build / x) if not x.startswith("/") else x for x in ins]

    cmd = [
        "/usr/lib/llvm-21/bin/clang++",
        *ins,
        "-Wl,--wrap=exp",
        "-Wl,--wrap=exp2",
        "-Wl,--wrap=expf",
        "-Wl,--wrap=fcntl64",
        "-Wl,--wrap=gettid",
        "-Wl,--wrap=log",
        "-Wl,--wrap=log2",
        "-Wl,--wrap=log2f",
        "-Wl,--wrap=logf",
        "-Wl,--wrap=pow",
        "-Wl,--wrap=powf",
        "-static-libstdc++",
        "-static-libgcc",
        "-Wl,--eh-frame-hdr",
        "--ld-path=/usr/lib/llvm-21/bin/ld.lld",
        "-fno-pic",
        "-Wl,-no-pie",
        "-Wl,--as-needed",
        "-Wl,-z,stack-size=12800000",
        "-Wl,--compress-debug-sections=zlib",
        "-Wl,-z,lazy",
        "-Wl,-z,norelro",
        "-Wl,-O2",
        "-Wl,--gdb-index",
        "-Wl,-z,combreloc",
        "-Wl,--sort-section=name",
        "-Wl,--hash-style=both",
        "-Wl,--build-id=sha1",
        "-Wl,--gc-sections",
        "-Wl,-icf=safe",
        f"-Wl,-Map={build / 'bun-profile.linker-map'}",
        "-Bsymbolics-functions",
        "-rdynamic",
        f"-Wl,--dynamic-list={root / 'src/symbols.dyn'}",
        f"-Wl,--version-script={root / 'src/linker.lds'}",
        "-L/tmp/libicu",
        "-lc",
        "-lpthread",
        "-ldl",
        "-l:libatomic.a",
        "-licudata",
        "-licui18n",
        "-licuuc",
        "-o",
        str(build / "bun-profile"),
    ]

    env = os.environ.copy()
    env["LIBRARY_PATH"] = "/usr/lib/aarch64-linux-gnu:" + env.get("LIBRARY_PATH", "")
    subprocess.run(cmd, check=True, env=env)


if __name__ == "__main__":
    main()

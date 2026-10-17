#!/usr/bin/env python3
"""Proposes `$likely(..)` and `$unlikely(..)` for Bun's built-in modules (src/js, src/aot/prelude), and checks the ones that are there.

    python3 branch-hints.py --bun /path/to/bun --modules /path/to/node_modules [--servers node,express,fastify] [--requests 3000]

`bun build --compile --aot` lays out code for the expected side of a test that is written `$likely(e)` or `$unlikely(e)`. No build
reads a profile: what is expected is written in the source, by a person. This tool only says where it would pay.

Each server of ../app is built with BUN_JSC_aotCountsBranches=1, which makes the executable count both sides of every test, and
serves every route of ../answers.ts. The tool then prints

  1. the marks that the counts contradict: the side that is marked as unlikely ran at least as often as the other;
  2. the tests in built-in modules without a mark of which one side never ran in any server, most frequent first, with the line
     and a caret under the operand.

A test that depends on what the client sends (does the request have a body?) looks one-sided here too. Mark what holds for
servers in general: errors, options that are rarely set, features that are rarely used, states that only a misbehaving peer causes.
"""
import argparse, collections, json, os, re, socket, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
SERVERS = os.path.dirname(HERE)
SOURCES = os.path.join(SERVERS, "..", "..", "..", "src")


def source_file(module):
    for prefix, folder in (("node:", "js/node/"), ("internal:", "js/internal/"), ("bun:", "js/bun/"), (".bun-aot-prelude/", "aot/prelude/")):
        if module.startswith(prefix):
            for extension in ("", ".ts", ".js"):
                path = os.path.join(SOURCES, folder + module[len(prefix):] + extension)
                if os.path.isfile(path):
                    return path
    return None


def is_negated_comparison(text, position):
    """Whether the operand that starts at `position` is `a != b` or `a !== b`: what is counted there is the comparison for equality."""
    depth = 0
    while position < len(text):
        character = text[position:position + 1]
        if character in b"([{":
            depth += 1
        elif character in b")]}":
            if not depth:
                return False
            depth -= 1
        elif text.startswith(b"//", position):
            position = text.find(b"\n", position)
            if position < 0:
                return False
        elif text.startswith(b"/*", position):
            position = text.find(b"*/", position) + 1
            if not position:
                return False
        elif character in b"\"'`":
            position += 1
            while position < len(text) and text[position:position + 1] != character:
                position += 2 if text[position:position + 1] == b"\\" else 1
        elif not depth:
            if text.startswith(b"!=", position):
                return True
            if character in b",;:" or text.startswith((b"&&", b"||", b"??"), position) or (character == b"?" and not text.startswith(b"?.", position)):
                return False
        position += 1
    return False


def request(port, route):
    body = route.get("request", "").encode()
    head = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: keep-alive\r\n" % (route["method"], route["path"], port)
    if body:
        head += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(body)
    return head.encode() + b"\r\n" + body


def read_response(connection):
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = connection.recv(65536)
        if not chunk:
            raise ConnectionError("the server closed the connection")
        data += chunk
    head, rest = data.split(b"\r\n\r\n", 1)
    length = re.search(rb"(?i)\r\ncontent-length: *(\d+)", head)
    if length:
        while len(rest) < int(length.group(1)):
            rest += connection.recv(65536)
    else:
        while not rest.endswith(b"0\r\n\r\n"):
            rest += connection.recv(65536)
    return int(head.split(b" ", 2)[1])


def count(options, work, server, routes):
    executable, map_path, counts = (os.path.join(work, server + suffix) for suffix in ("", ".map", ".counts"))
    environment = {**os.environ, "BUN_JSC_aotCountsBranches": "1", "BUN_JSC_aotMapFilePath": map_path, "NODE_ENV": "production"}
    subprocess.run([options.bun, "build", "--compile", "--aot", "--target=bun", "./%s.ts" % server, "--outfile", executable], cwd=os.path.join(work, "app"), env=environment, check=True, stdout=subprocess.DEVNULL)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment = {**os.environ, "PORT": str(port), "NODE_ENV": "production", "BUN_JSC_useAOTOperationCounters": "1", "BUN_JSC_aotTypeCoverageCountsPath": counts}
    process = subprocess.Popen([executable], env=environment, stdout=subprocess.DEVNULL)
    try:
        for attempt in range(200):
            try:
                connection = socket.create_connection(("127.0.0.1", port))
                break
            except OSError:
                time.sleep(0.05)
        for route in routes:
            text = request(port, route)
            for _ in range(options.requests):
                connection.sendall(text)
                if read_response(connection) != route.get("status", 200):
                    sys.exit("%s: %s did not answer with %d" % (server, route["name"], route.get("status", 200)))
        connection.close()
        process.terminate()
        process.wait(10)
    finally:
        process.kill()
    names = {}
    for line in open(map_path, errors="replace"):
        if line.startswith("Q\t"):
            _, number, path = line.rstrip("\n").split("\t")
            names[number] = path
    sides = collections.defaultdict(lambda: [0, 0])
    for line in open(counts + ".operations", errors="replace"):
        found = re.match(r"(\d+)\tBranch:at:(\d+):(\d+):bc(\d+)$", line)
        if found and found.group(2) in names:
            sides[(names[found.group(2)], int(found.group(3)))][int(found.group(4)) & 1] += int(found.group(1))
    return sides


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bun", required=True)
    parser.add_argument("--modules", help="a node_modules folder with the packages of ../app/package.json")
    parser.add_argument("--servers", default="node,express,fastify")
    parser.add_argument("--requests", type=int, default=3000)
    parser.add_argument("--shown", type=int, default=100)
    options = parser.parse_args()
    routes = json.loads(subprocess.run([options.bun, os.path.join(SERVERS, "answers.ts")], check=True, capture_output=True).stdout)["routes"]
    tests = collections.defaultdict(dict)
    with tempfile.TemporaryDirectory() as work:
        subprocess.run(["cp", "-r", os.path.join(SERVERS, "app"), os.path.join(work, "app")], check=True)
        if options.modules:
            os.symlink(os.path.abspath(options.modules), os.path.join(work, "app", "node_modules"))
        for server in options.servers.split(","):
            for test, sides in count(options, work, server, routes).items():
                tests[test][server] = sides
    contradicted, proposed = [], []
    for (module, position), servers in tests.items():
        path = source_file(module)
        if not path:
            continue
        text = open(path, "rb").read()
        when_true, when_false = sum(sides[0] for sides in servers.values()), sum(sides[1] for sides in servers.values())
        if is_negated_comparison(text, position):
            when_true, when_false = when_false, when_true
        start = text.rfind(b"\n", 0, position) + 1
        end = text.find(b"\n", position)
        where = "%s:%d\n    %s\n    %s^" % (os.path.relpath(path, os.path.join(SOURCES, "..")), text.count(b"\n", 0, position) + 1, text[start:end].decode(errors="replace"), " " * (position - start))
        mark = re.search(rb"\$(un)?likely\((?:!|\()*$", text[start:position])
        if mark:
            negations = mark.group(0).count(b"!")
            expects_true = (mark.group(1) is None) != bool(negations & 1)
            if (when_false if expects_true else when_true) >= (when_true if expects_true else when_false):
                contradicted.append((when_true + when_false, "true %d, false %d: %s" % (when_true, when_false, where)))
        elif not when_true or not when_false:
            proposed.append((when_true + when_false, "always %s, %d times in %s: %s" % ("true" if when_true else "false", when_true + when_false, ", ".join(sorted(servers)), where)))
    print("%d marks are contradicted by the counts" % len(contradicted))
    for _, line in sorted(contradicted, reverse=True):
        print(line)
    print("%d tests without a mark ran one side only; the first %d:" % (len(proposed), min(len(proposed), options.shown)))
    for _, line in sorted(proposed, reverse=True)[:options.shown]:
        print(line)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Which functions of a warm server call a stub that finds a property by its name, behind which test, how often a request? Linux x64 only; needs `cc` and `objdump`. No counter of the processor is read, so a busy machine prints the same.

    BUN_JSC_aotMapFilePath=server.map bun build --compile --aot ./server.ts --outfile server
    python3 stubs_by_request.py server server.map request.txt [--requests 20] [--warm-up 400] [--stubs REGEX]

`request.txt` holds one HTTP/1.1 request, byte for byte. The server takes its port from PORT and prints "listening <port>".

In machine code such a call is a `jmp` or `call` from a Body or CoroutineBody to the stub, and the map says where each unit and each stub lies. Every such instruction gets a breakpoint
(./count_sites.c), the warm server is sent some requests on one connection, and what ran is counted: the accesses by name that a request runs. `--stubs`: the stubs whose names match.
A second run watches, for each call that ran, the conditional jumps from which it is reached without a further choice, and prints the one that was
taken with the instructions in front of it and the registers: `cmp $0xffffff1a,%eax` is a test of the shape word against shape 230 (0x100000000 - 0xffffff1a; `testaot plan x.wire shapes` names
the layout), and a shape word of 0 is an ordinary object. `testaot bytes x.wire f<n>:Body references=narrow` lists each relocation of a unit by its offset.
"""
import argparse, bisect, collections, os, re, signal, socket, struct, subprocess, tempfile, time

parser = argparse.ArgumentParser()
parser.add_argument("executable")
parser.add_argument("map")
parser.add_argument("request")
parser.add_argument("--requests", type=int, default=20)
parser.add_argument("--warm-up", type=int, default=400)
parser.add_argument("--stubs", default=r"^(GetBy|PutBy|PutKnownField|CallMethodById|GetLength|InBy|StoreSlot\.|ReadSlot\.ById|DeleteBy)")
options = parser.parse_args()

work = tempfile.mkdtemp(prefix="stubs-")
counter = os.path.join(work, "count_sites")
subprocess.run(["cc", "-O1", "-o", counter, os.path.join(os.path.dirname(os.path.abspath(__file__)), "count_sites.c")], check=True)
request = open(options.request, "rb").read()

units, stubs = [], []
for line in open(options.map, errors="replace"):
    fields = line.rstrip("\n").split("\t")
    if fields[0] == "F":
        units.append((int(fields[2]), int(fields[3]), fields[7] or "(anonymous)", fields[8], fields[10].split("/")[-1], fields[11]))
    elif fields[0] == "T":
        stubs.append((int(fields[1]), fields[2]))
stubs.sort()
stub_starts = [start for start, _ in stubs]
first_unit = min(unit[0] for unit in units)


def ask(connection, times):
    for _ in range(times):
        connection.sendall(request)
        data = b""
        while b"\r\n\r\n" not in data:
            data += connection.recv(65536)
        head, _, body = data.partition(b"\r\n\r\n")
        length = re.search(rb"content-length: (\d+)", head, re.I)
        if length:
            while len(body) < int(length.group(1)):
                body += connection.recv(65536)
        elif b"chunked" in head.lower():
            while not body.endswith(b"0\r\n\r\n"):
                body += connection.recv(65536)


class WarmServer:
    def __init__(self):
        log = os.path.join(work, "server.log")
        self.process = subprocess.Popen([options.executable], env={**os.environ, "PORT": "0"}, stdout=open(log, "w"), stderr=subprocess.STDOUT)
        port = 0
        for _ in range(300):
            found = re.search(r"listening\D*(\d+)", open(log).read())
            if found:
                port = int(found.group(1))
                break
            time.sleep(0.1)
        assert port, "the server did not listen: " + open(log).read()[:500]
        name = os.path.basename(options.executable)
        # The compiled code is the last executable mapping of the file.
        self.base = [int(line.split("-")[0], 16) for line in open(f"/proc/{self.process.pid}/maps") if "r-xp" in line and name in line][-1]
        self.connection = socket.create_connection(("127.0.0.1", port))
        ask(self.connection, options.warm_up)
        self.memory = open(f"/proc/{self.process.pid}/mem", "rb")

    def read(self, offset, size):
        self.memory.seek(self.base + offset)
        return self.memory.read(size)

    def count(self, sites):
        """`sites`: offset -> offset of a target or None. Returns offset -> (runs, times it went to the target, order of first run, registers). Ends the server."""
        listed = os.path.join(work, "sites.txt")
        with open(listed, "w") as file:
            for offset, target in sites.items():
                file.write(f"{self.base + offset:x} {self.base + target if target is not None else 0:x}\n")
        tool = subprocess.Popen([counter, str(self.process.pid), listed], stdout=subprocess.PIPE, text=True)
        assert tool.stdout.readline().strip() == "READY"
        ask(self.connection, options.requests)
        time.sleep(0.2)
        tool.send_signal(signal.SIGINT)
        printed, _ = tool.communicate()
        self.process.kill()
        counts = {}
        for line in printed.splitlines():
            fields = line.split()
            counts[int(fields[0], 16) - self.base] = (int(fields[1]), int(fields[2]), int(fields[3]), " ".join(fields[4:]))
        return counts


server = WarmServer()
sites = {}
for start, size, name, role, path, position in units:
    if role not in ("Body", "CoroutineBody"):
        continue
    code = server.read(start, size)
    for found in re.finditer(rb"[\xe8\xe9]", code[:-4]):
        at = found.start()
        target = start + at + 5 + struct.unpack_from("<i", code, at + 1)[0]
        index = bisect.bisect_right(stub_starts, target) - 1
        if 0 <= target < first_unit and index >= 0 and stubs[index][0] == target and re.search(options.stubs, stubs[index][1]):
            sites[start + at] = (start, size, name, role, path, position, stubs[index][1])
ran = server.count({offset: None for offset in sites})
print(f"{sum(count[0] for count in ran.values()) / options.requests:.1f} calls of stubs that go by name a request at {len(ran)} of {len(sites)} sites, over {options.requests} requests behind {options.warm_up}", flush=True)

server = WarmServer()
watched, listings = {}, {}
for offset in ran:
    start, size = sites[offset][:2]
    if start not in listings:
        binary = os.path.join(work, "unit.bin")
        open(binary, "wb").write(server.read(start, size))
        rows = []
        for line in subprocess.run(["objdump", "-D", "-b", "binary", "-mi386:x86-64", "--no-show-raw-insn", binary], capture_output=True, text=True).stdout.splitlines():
            row = re.match(r"\s*([0-9a-f]+):\s+(\S+)\s*(.*)", line)
            if row:
                rows.append((int(row.group(1), 16), row.group(2), row.group(3)))
        listings[start] = rows
    rows = listings[start]
    index_of = {at: index for index, (at, _, _) in enumerate(rows)}
    jumps_to = collections.defaultdict(list)
    for index, (at, operation, operands) in enumerate(rows):
        if operation.startswith("j") and re.match(r"0x[0-9a-f]+", operands):
            jumps_to[int(operands.split()[0], 16)].append(index)
    # Backwards from the site: the straight line that ends in it, and the straight lines that jump to a place on it.
    todo, seen = [index_of[offset - start]], set()
    while todo:
        index = todo.pop()
        while index not in seen:
            seen.add(index)
            for jump in jumps_to.get(rows[index][0], []):
                if rows[jump][1] == "jmp":
                    todo.append(jump)
                else:
                    watched[start + rows[jump][0]] = (start + rows[index][0], offset)
            if index == 0 or rows[index - 1][1] in ("jmp", "ret", "ud2", "int3"):
                break
            if rows[index - 1][1].startswith("j"):
                watched.setdefault(start + rows[index - 1][0], (start + rows[index][0], offset))
                break
            index -= 1
taken = server.count({jump: target for jump, (target, _) in watched.items()})
jumps_of = collections.defaultdict(list)
for jump, (_, went, _, registers) in taken.items():
    if went:
        jumps_of[watched[jump][1]].append((jump, went, registers))
for offset, (runs, _, _, _) in sorted(ran.items(), key=lambda item: -item[1][0]):
    start, size, name, role, path, position, goal = sites[offset]
    print(f"\n{runs / options.requests:5.2f} a request: {name}:{role} {path}@{position} at +{offset - start:#x} for {goal}")
    rows = listings[start]
    index_of = {at: index for index, (at, _, _) in enumerate(rows)}
    for jump, went, registers in sorted(jumps_of.get(offset, [])):
        index = index_of[jump - start]
        print(f"   {went / options.requests:5.2f} by the jump at +{jump - start:#x}, which goes to +{watched[jump][0] - start:#x}:")
        for at, operation, operands in rows[max(0, index - 6):index + 1]:
            print(f"        +{at:#x}: {operation} {operands}")
        print(f"        {registers}")

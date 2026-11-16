#!/usr/bin/env python3
"""Runs a command and, if it dies of a signal, says where, on one line. Linux on x86-64 and ARM64; it needs no debugger.

    python3 test/aot/shell/where-it-died.py [--image <image> --map <map of the image>] [--seconds <n>] <command>...

A machine that only a continuous build has can say no more than "died of signal 11". This follows the command and all its threads with
ptrace. At each signal that a fault raises it notes the state of the thread and hands the signal on, so a fault that the engine catches
itself goes on as it would. If the command then dies of a signal, the last note is printed:

    signal 11 code 1 at 0x18 | pc <place> | lr <place> | called from <place> < <place> ... | words of the stack that point into code <place> ... | registers x0=... | code <words before pc> > <words from pc on>

A <place> is `<file>+0x<offset in the file>` for an address that a file is mapped at, with the function's name if the file has its symbols, else
`0x<address> (<what /proc/<pid>/maps says>)`.
With --image and --map (`JSC_aotMapFilePath=<map> testaot compile ...`) a place in the code of the image is `<function or stub>+0x<offset>`.
Prints nothing if the command does not die of a signal, and `not followed: <why>` where it cannot follow it. The command's own output is dropped.
"""
import bisect, ctypes, os, platform, signal, struct, sys

TRACEME, CONT, SETOPTIONS, GETSIGINFO, GETREGSET = 0, 7, 0x4200, 0x4202, 0x4204
TRACE_CLONE, EXIT_KILL = 0x8, 0x100000
ALL_CHILDREN = 0x40000000  # __WALL
FAULTS = {signal.SIGSEGV, signal.SIGBUS, signal.SIGILL, signal.SIGFPE, signal.SIGABRT, signal.SIGTRAP}
# The order of the general registers in NT_PRSTATUS.
REGISTERS = {
    "aarch64": [f"x{n}" for n in range(31)] + ["sp", "pc", "pstate"],
    "x86_64": "r15 r14 r13 r12 rbp rbx r11 r10 r9 r8 rax rcx rdx rsi rdi orig_rax rip cs eflags rsp ss fs_base gs_base ds es fs gs".split(),
}
IMAGE_MAGIC = struct.pack("<Q", 0x3130544F414E5542)


class IOVector(ctypes.Structure):
    _fields_ = [("base", ctypes.c_void_p), ("length", ctypes.c_size_t)]


def names_of_image(image, map_file):
    """Returns (offset of the code in the image file, its size, sorted [(offset in the code, name)])."""
    with open(image, "rb") as file:
        head = file.read(64)
    if head[:8] != IMAGE_MAGIC:
        return None
    _, code, code_size, _ = struct.unpack_from("<QQQQ", head, 32)
    marks = []
    for line in open(map_file, errors="replace"):
        fields = line.rstrip("\n").split("\t")
        if fields[0] == "F":
            marks.append((int(fields[2]), f"{fields[7] or '(module)'}[{fields[8]}]"))
        elif fields[0] == "T":
            marks.append((int(fields[1]), "stub " + fields[2]))
    return code, code_size, sorted(marks)


def symbols_of(path):
    """Returns ([(offset in the file, size in the file, address) of each loaded segment], sorted [(address, name of a function)]) of a 64-bit little-endian ELF file; the second is empty if it was stripped."""
    try:
        with open(path, "rb") as file:
            head = file.read(64)
            if head[:6] != b"\x7fELF\x02\x01":
                return [], []
            segments_at, sections_at = struct.unpack_from("<QQ", head, 32)
            segment_size, segment_count, section_size, section_count = struct.unpack_from("<HHHH", head, 54)
            file.seek(segments_at)
            segments = [struct.unpack_from("<IIQQQQ", file.read(segment_size)) for _ in range(segment_count)]
            file.seek(sections_at)
            sections = [struct.unpack_from("<IIQQQQII", file.read(section_size)) for _ in range(section_count)]
            functions = []
            for section in sections:
                if section[1] != 2:  # SHT_SYMTAB
                    continue
                file.seek(sections[section[6]][4])
                strings = file.read(sections[section[6]][5])
                file.seek(section[4])
                for name, information, _, _, value, _ in struct.iter_unpack("<IBBHQQ", file.read(section[5] // 24 * 24)):
                    if information & 15 == 2 and value:  # STT_FUNC
                        functions.append((value, name))
            functions.sort()
            return [(offset, size, address) for kind, _, offset, address, _, size in segments if kind == 1], [(value, strings[name:strings.index(b"\0", name)].decode(errors="replace")) for value, name in functions]
    except (OSError, struct.error, IndexError, ValueError):
        return [], []


class Followed:
    def __init__(self, process, image, names):
        self.process, self.image, self.names, self.symbols = process, image and os.path.realpath(image), names, {}
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libc.ptrace.argtypes = [ctypes.c_long, ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p]
        self.libc.ptrace.restype = ctypes.c_long

    def ptrace(self, request, thread, address=None, data=None):
        return self.libc.ptrace(request, thread, address, data)

    def read(self, address, size):
        try:
            with open(f"/proc/{self.process}/mem", "rb", buffering=0) as memory:
                memory.seek(address)
                return memory.read(size)
        except (OSError, ValueError, OverflowError):
            return b""

    def mappings(self):
        found = []
        for line in open(f"/proc/{self.process}/maps"):
            fields = line.split(None, 5)
            start, end = (int(x, 16) for x in fields[0].split("-"))
            found.append((start, end, fields[1], int(fields[2], 16), fields[5].strip() if len(fields) > 5 else ""))
        return found

    def code_of_image(self, mappings):
        """Where the code of the image begins in memory, if the engine has the whole image in one piece there: it begins with its magic number."""
        if not self.names:
            return None
        for start, _, permissions, _, _ in mappings:
            if "r" in permissions and self.read(start, 8) == IMAGE_MAGIC:
                return start + self.names[0]
        return None

    def place_in_code(self, offset):
        marks = self.names[2]
        at = bisect.bisect_right(marks, (offset, "\U0010ffff")) - 1
        return f"{marks[at][1]}+0x{offset - marks[at][0]:x} (code+0x{offset:x})" if at >= 0 else f"code+0x{offset:x}"

    def function_at(self, path, in_file):
        if path not in self.symbols:
            self.symbols[path] = symbols_of(path)
        segments, functions = self.symbols[path]
        for offset, size, address in segments:
            if offset <= in_file < offset + size and functions:
                at = bisect.bisect_right(functions, (in_file - offset + address, "\U0010ffff")) - 1
                return f" ({functions[at][1][:90]}+0x{in_file - offset + address - functions[at][0]:x})" if at >= 0 else ""
        return ""

    def place(self, address, mappings, code):
        if code is not None and code <= address < code + self.names[1]:
            return self.place_in_code(address - code)
        for start, end, permissions, offset, path in mappings:
            if start <= address < end:
                in_file = address - start + offset
                if self.names and path == self.image and self.names[0] <= in_file < self.names[0] + self.names[1]:
                    return self.place_in_code(in_file - self.names[0])
                if path.startswith("/"):
                    return f"{os.path.basename(path)}+0x{in_file:x}" + self.function_at(path, in_file)
                return f"0x{address:x} ({permissions} {path or 'anonymous'}+0x{address - start:x})"
        return f"0x{address:x} (nothing is mapped there)"

    def note(self, thread, names):
        information = ctypes.create_string_buffer(128)
        self.ptrace(GETSIGINFO, thread, None, ctypes.addressof(information))
        number, _, code = struct.unpack_from("iii", information.raw, 0)
        faulted_at = struct.unpack_from("Q", information.raw, 16)[0]
        buffer = ctypes.create_string_buffer(8 * len(names))
        vector = IOVector(ctypes.addressof(buffer), len(buffer))
        if self.ptrace(GETREGSET, thread, 1, ctypes.addressof(vector)) != 0:
            return f"signal {number} code {code} at 0x{faulted_at:x} | the registers cannot be read"
        registers = dict(zip(names, struct.unpack(f"<{len(names)}Q", buffer.raw)))
        arm = "pc" in registers
        pc, frame = (registers["pc"], registers["x29"]) if arm else (registers["rip"], registers["rbp"])
        mappings = self.mappings()
        code_start = self.code_of_image(mappings)
        parts = [f"signal {number} code {code} at 0x{faulted_at:x}", ("" if thread == self.process else "in another thread than the first | ") + "pc " + self.place(pc, mappings, code_start)]
        if arm:
            parts.append("lr " + self.place(registers["x30"], mappings, code_start))
        callers = []
        while len(callers) < 24:
            record = self.read(frame, 16)
            if len(record) != 16:
                break
            above, returns_to = struct.unpack("<QQ", record)
            callers.append(self.place(returns_to, mappings, code_start))
            if above <= frame:
                break
            frame = above
        parts.append("called from " + " < ".join(callers))
        # Code without frame records breaks that chain: what lies on the stack and points into code says the rest.
        stack = self.read(registers["sp" if arm else "rsp"], 8 * 768)
        executable = [(start, end) for start, end, permissions, _, _ in mappings if "x" in permissions]
        pointers = [word for word, in struct.iter_unpack("<Q", stack[:len(stack) & ~7]) if any(start <= word < end for start, end in executable)]
        parts.append("words of the stack that point into code " + " ".join(self.place(word, mappings, code_start) for word in pointers[:32]))
        parts.append("registers " + " ".join(f"{name}={value:x}" for name, value in registers.items()))
        words = lambda data: " ".join(data[at:at + 4][::-1].hex() for at in range(0, len(data), 4)) if arm else data.hex()
        parts.append(f"code {words(self.read(pc - 32, 32))} > {words(self.read(pc, 16))}")
        return " | ".join(parts)


def follow(command, image, names, seconds):
    registers = REGISTERS.get(platform.machine())
    if sys.platform != "linux" or not registers:
        return "not followed: this is neither Linux on x86-64 nor Linux on ARM64"
    process = os.fork()
    if process == 0:
        try:
            nothing = os.open(os.devnull, os.O_RDWR)
            for descriptor in (0, 1, 2):
                os.dup2(nothing, descriptor)
            ctypes.CDLL(None).ptrace(TRACEME, 0, None, None)
            os.execv(command[0], command)
        finally:
            os._exit(127)
    followed = Followed(process, image, names)
    _, status = os.waitpid(process, ALL_CHILDREN)
    if not os.WIFSTOPPED(status):
        return "not followed: the command did not stop at its start, so ptrace is not allowed here"
    if followed.ptrace(SETOPTIONS, process, None, TRACE_CLONE | EXIT_KILL) != 0:
        os.kill(process, signal.SIGKILL)
        return "not followed: ptrace is not allowed here"
    signal.signal(signal.SIGALRM, lambda *_: os.kill(process, signal.SIGKILL))
    signal.alarm(seconds)
    followed.ptrace(CONT, process, None, 0)
    known, last = {process}, None
    while True:
        try:
            thread, status = os.waitpid(-1, ALL_CHILDREN)
        except ChildProcessError:
            return None
        if not os.WIFSTOPPED(status):
            if thread != process:
                continue
            if not os.WIFSIGNALED(status):
                return None
            died_of = os.WTERMSIG(status)
            if last and last.startswith(f"signal {died_of} "):
                return last
            return f"signal {died_of}, " + (f"and the last fault before it: {last}" if last else "and no fault was seen")
        stopped_by, handed_on = os.WSTOPSIG(status), 0
        if status >> 16:
            pass  # A thread was made.
        elif thread not in known:
            known.add(thread)  # A new thread begins stopped.
        elif stopped_by in FAULTS:
            last, handed_on = followed.note(thread, registers), stopped_by
        else:
            handed_on = stopped_by
        followed.ptrace(CONT, thread, None, handed_on)


if __name__ == "__main__":
    arguments, settings = sys.argv[1:], {"--seconds": "120"}
    while arguments[:1] and arguments[0] in ("--image", "--map", "--seconds"):
        settings[arguments[0]], arguments = arguments[1], arguments[2:]
    if not arguments:
        sys.exit(__doc__)
    names = names_of_image(settings["--image"], settings["--map"]) if "--image" in settings and os.path.isfile(settings.get("--map", "")) else None
    said = follow(arguments, settings.get("--image"), names, int(settings["--seconds"]))
    if said:
        print(said)

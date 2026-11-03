import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";

// The modules _bz2 and _lzma, over libbzip2 and liblzma as Bun builds them. How they answer a program is compared with CPython
// elsewhere. Here is what depends on the build (which parts of the libraries are there) and on this runtime (threads, memory).

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(120_000);

async function run(main: string) {
  using dir = tempDir("python-compression", { "main.py": main });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, maxRSS: proc.resourceUsage()!.maxRSS };
}

const lines = (...all: string[]) => all.map(line => line + "\n").join("");
const printed = (...all: string[]) => ({ stdout: lines(...all), stderr: "", exitCode: 0 });

test.concurrent("bz2 and lzma read what other builds of the libraries wrote", async () => {
  const { maxRSS, ...result } = await run(`
import base64, bz2, lzma

text = b"hello world\\n"
# bzip2 1.0.8
print(bz2.decompress(bytes.fromhex("425a68393141592653594eece83600000251800010400006449080200031064c4101a7a9a580bb9431f8bb9229c28482776741b0")))
print(bz2.decompress(base64.b64decode("QlpoMTFBWSZTWYla7IwAAHzRgAAQQAAGRJCAIABAUqhmiEGTEeosRYixFpFxFxFoi6ixF1F+LuSKcKEhErXZGA==")) == text * 50)
# The format leaves the compressor no choice that the library does not always make alike.
print(bz2.compress(text).hex())

# liblzma 5.4: .xz, .lzma, .xz with a delta filter, the x86 filter, LZMA2 and SHA-256, and .lz
for stream in (
    "/Td6WFoAAATm1rRGAgAhARYAAAB0L+WjAQALaGVsbG8gd29ybGQKAKHy/8Rqf7/PAAEkDKYY2NgftvN9AQAAAAAEWVo=",
    "XQAAgAD//////////wA0GUnujekXiTozX/yyCYIv//3igAA=",
    "/Td6WFoAAArh+wyhAwIDAQEEACEBFAAA7ky8z+ACVwAZXQA0GTyAT+dhy+owUVCwBGgnZ/IF8764qAAAAAAAAJ3SBnVQk7qXaMOCM03PRwjpt7j1xaMt4flmFW05gLM/AAFR2AQAAABArGAytunfHAIAAAAAClla",
    "TFpJUAEQADQZSe6N6ReJOjNf/LQEscoDNCPzGP///fRwABeA4VBYAgAAAAAAADYAAAAAAAAA",
):
    d = lzma.LZMADecompressor()
    out = d.decompress(base64.b64decode(stream))
    print(len(out), out == text * (len(out) // len(text)), d.check, d.eof)
`);
  expect(result).toEqual(
    printed(
      "b'hello world\\n'",
      "True",
      "425a68393141592653594eece83600000251800010400006449080200031064c4101a7a9a580bb9431f8bb9229c28482776741b0",
      "12 True 4 True",
      "12 True 0 True",
      "600 True 10 True",
      "600 True 1 True",
    ),
  );
});

test.concurrent("every format, check, match finder and filter of lzma is in the build", async () => {
  const { maxRSS, ...result } = await run(`
import lzma

data = bytes((i * 7 + (i >> 6)) & 255 for i in range(20000)) + b"the same words again and again " * 300
lzma2 = {"id": lzma.FILTER_LZMA2, "preset": 0}

print([lzma.is_check_supported(c) for c in (lzma.CHECK_NONE, lzma.CHECK_CRC32, lzma.CHECK_CRC64, lzma.CHECK_SHA256)])
for check in (lzma.CHECK_NONE, lzma.CHECK_CRC32, lzma.CHECK_CRC64, lzma.CHECK_SHA256):
    d = lzma.LZMADecompressor()
    print(d.decompress(lzma.compress(data, check=check, preset=0)) == data, d.check)
print([lzma.decompress(lzma.compress(data, format, preset=1), format) == data for format in (lzma.FORMAT_XZ, lzma.FORMAT_ALONE)])
for name in ("MF_HC3", "MF_HC4", "MF_BT2", "MF_BT3", "MF_BT4"):
    chain = [{**lzma2, "mf": getattr(lzma, name)}]
    print(name, lzma.decompress(lzma.compress(data, lzma.FORMAT_RAW, filters=chain), lzma.FORMAT_RAW, filters=chain) == data)
for name in ("FILTER_DELTA", "FILTER_X86", "FILTER_POWERPC", "FILTER_IA64", "FILTER_ARM", "FILTER_ARMTHUMB", "FILTER_SPARC"):
    print(name, lzma.decompress(lzma.compress(data, filters=[{"id": getattr(lzma, name)}, lzma2])) == data)
chain = [{"id": lzma.FILTER_LZMA1, "preset": 0}]
print("FILTER_LZMA1", lzma.decompress(lzma.compress(data, lzma.FORMAT_RAW, filters=chain), lzma.FORMAT_RAW, filters=chain) == data)
`);
  expect(result).toEqual(
    printed(
      "[True, True, True, True]",
      "True 0",
      "True 1",
      "True 4",
      "True 10",
      "[True, True]",
      "MF_HC3 True",
      "MF_HC4 True",
      "MF_BT2 True",
      "MF_BT3 True",
      "MF_BT4 True",
      "FILTER_DELTA True",
      "FILTER_X86 True",
      "FILTER_POWERPC True",
      "FILTER_IA64 True",
      "FILTER_ARM True",
      "FILTER_ARMTHUMB True",
      "FILTER_SPARC True",
      "FILTER_LZMA1 True",
    ),
  );
});

test.concurrent("tarfile, zipfile and shutil write and read bzip2 and xz", async () => {
  const { maxRSS, ...result } = await run(`
import os, shutil, tarfile, zipfile

os.mkdir("tree")
body = b"".join(b"line %d\\n" % i for i in range(2000))
with open("tree/a.txt", "wb") as f:
    f.write(body)

for kind in ("bz2", "xz"):
    with tarfile.open("t.tar." + kind, "w:" + kind) as tar:
        tar.add("tree")
    with tarfile.open("t.tar." + kind) as tar:
        print(kind, tar.getnames(), tar.extractfile("tree/a.txt").read() == body)
for name in ("ZIP_BZIP2", "ZIP_LZMA"):
    with zipfile.ZipFile("z.zip", "w", getattr(zipfile, name)) as z:
        z.write("tree/a.txt")
    with zipfile.ZipFile("z.zip") as z:
        print(name, z.testzip(), z.read("tree/a.txt") == body, z.getinfo("tree/a.txt").compress_size < len(body) // 3)
for format in ("bztar", "xztar"):
    archive = shutil.make_archive("made", format, "tree")
    shutil.unpack_archive(archive, "out-" + format)
    print(format, os.path.basename(archive), open("out-" + format + "/a.txt", "rb").read() == body)
`);
  expect(result).toEqual(
    printed(
      "bz2 ['tree', 'tree/a.txt'] True",
      "xz ['tree', 'tree/a.txt'] True",
      "ZIP_BZIP2 None True True",
      "ZIP_LZMA None True True",
      "bztar made.tar.bz2 True",
      "xztar made.tar.xz True",
    ),
  );
});

// Threads are POSIX only so far.
(isWindows ? test.skip : test.concurrent)("threads share an object, and run while a library works", async () => {
  const { maxRSS, ...result } = await run(`
import bz2, lzma, random, threading

def together(count, target):
    threads = [threading.Thread(target=target, args=(i,)) for i in range(count)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()

blocks = [bytes([i]) * 4000 + random.Random(i).randbytes(1000) for i in range(30)]
for name, compressor, decompress in (("bz2", bz2.BZ2Compressor(), bz2.decompress), ("lzma", lzma.LZMACompressor(preset=0), lzma.decompress)):
    # A call is atomic. Where its output belongs in the stream only the compressor knows, so the program has a lock for that.
    parts, lock = [], threading.Lock()
    def feed(i):
        for block in blocks[i::5]:
            with lock:
                parts.append(compressor.compress(block))
    together(5, feed)
    out = decompress(b"".join(parts) + compressor.flush())
    print(name, sorted(out[i:i + 5000] for i in range(0, len(out), 5000)) == sorted(blocks))

data = b"".join(blocks)
for name, decompressor, packed in (("bz2", bz2.BZ2Decompressor(), bz2.compress(data)), ("lzma", lzma.LZMADecompressor(), lzma.compress(data, preset=0))):
    # Without a lock: each byte comes out once, to one of them.
    got = [decompressor.decompress(packed, 100)]
    def take(i):
        try:
            while True:
                got.append(decompressor.decompress(b"", 999))
        except EOFError:
            pass
    together(5, take)
    print(name, sum(map(len, got)) == len(data), sorted(b"".join(got)) == sorted(data), decompressor.eof)

big = random.Random(1).randbytes(1_000_000)
for name, compress in (("bz2", bz2.compress), ("lzma", lambda data: lzma.compress(data, preset=1))):
    begun, done, ticks = threading.Event(), threading.Event(), 0
    def work():
        begun.set()
        compress(big)
        done.set()
    worker = threading.Thread(target=work)
    worker.start()
    begun.wait()
    while not done.is_set():
        ticks += 1
    worker.join()
    print(name, ticks > 0)
`);
  expect(result).toEqual(
    printed("bz2 True", "lzma True", "bz2 True True True", "lzma True True True", "bz2 True", "lzma True"),
  );
});

test.concurrent("the memory of the libraries goes with the stream, or else with the object", async () => {
  // An encoder at the default preset asks for 94 MB and writes to 17 MB of them at once.
  const { maxRSS, ...result } = await run(`
import lzma, weakref

# Dropped halfway: the collector has to hear what it would gain, for the objects themselves are too small to make it run.
class Witness: pass
def witnesses():
    return [weakref.ref(Witness()) for i in range(10)]
alive, dropped = witnesses(), 0
while all(witness() is not None for witness in alive) and dropped < 200:
    lzma.LZMACompressor().compress(b"x")
    dropped += 1
print(dropped < 200)

# Used up, and kept.
kept = []
for i in range(150):
    compressor = lzma.LZMACompressor()
    compressor.compress(b"x")
    compressor.flush()
    kept.append(compressor)
print(len(kept))
`);
  expect(result).toEqual(printed("True", "150"));
  // 2.5 GB more than at the start if the second half frees nothing.
  expect(maxRSS).toBeLessThan((isASAN ? 1500 : 800) * 1024 * 1024);
});

import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { meets, run, supported } from "../run-fixtures";

// Miscompile checks on real code: parts of the vendored libraries are compiled from their sources by Bun's
// C compiler, linked with a small driver and run against known answers. They read the vendored sources, so
// they only run when asked to (BUN_C_COMPILER_HEAVY_TESTS=1), and each does nothing when its sources are
// not on disk.
const repo = join(import.meta.dir, "../../../../../..");
const heavy = supported && process.env.BUN_C_COMPILER_HEAVY_TESTS === "1";
const vendor = (name: string) => join(repo, "vendor", name);
const generated = (name: string) => join(repo, "build/release-local/deps", name);

/** A reproducible buffer with every byte value and some runs in it; `sampleInC` is the same generator. */
function sample(length: number) {
  const bytes = new Uint8Array(length);
  let state = 0x2545f4914f6cdd1dn;
  for (let i = 0; i < length; i++) {
    state ^= (state << 13n) & 0xffffffffffffffffn;
    state ^= state >> 7n;
    state ^= (state << 17n) & 0xffffffffffffffffn;
    bytes[i] = i % 97 < 20 ? 0x61 : Number((state >> 32n) & 0xffn);
  }
  return bytes;
}
const sampleInC = `
static void sample(unsigned char *out, unsigned long length) {
  unsigned long long state = 0x2545f4914f6cdd1dULL;
  for (unsigned long i = 0; i < length; i++) {
    state ^= state << 13; state ^= state >> 7; state ^= state << 17;
    out[i] = i % 97 < 20 ? 'a' : (unsigned char)(state >> 32);
  }
}
`;
const bytesInC = (bytes: Uint8Array | number[]) => [...bytes].join(", ");

/**
 * Links `sources` (each behind the `defines`) with `driver`, which has the `main`, and runs the program.
 * `bun build --compile` takes no -D or -I: every file is compiled through a wrapper that defines the macros and
 * includes it, and the directories go in C_INCLUDE_PATH.
 */
async function runProgram(name: string, sources: string[], defines: string[], includeDirs: string[], driver: string) {
  const macros = defines
    .map(define => {
      const [macro, value] = define.split("=");
      return `#define ${macro} ${value ?? 1}\n`;
    })
    .join("");
  const files: Record<string, string> = { "main.c": macros + driver };
  sources.forEach((source, index) => (files[`unit${index}.c`] = `${macros}#include "${source}"\n`));
  using dir = tempDir(`bir-${name}`, files);
  const env = { ...bunEnv, C_INCLUDE_PATH: includeDirs.join(":") };
  const exe = join(String(dir), "program");
  const units = sources.map((_, index) => `unit${index}.c`);
  const build = await run(String(dir), ["build", "--compile", "main.c", ...units, "--outfile", exe], env);
  expect(build.exitCode, build.stderr.slice(0, 2000)).toBe(0);
  await using proc = Bun.spawn({ cmd: [exe], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode, stderr.slice(0, 2000)).toBe(0);
  return stdout;
}

const sourcesIn = (root: string, dirs: string[]) =>
  dirs.flatMap(dir =>
    readdirSync(join(root, dir))
      .filter(file => file.endsWith(".c"))
      .sort()
      .map(file => join(root, dir, file)),
  );

describe.skipIf(!heavy)("vendored libraries", () => {
  const lengths = [0, 1, 15, 16, 17, 63, 64, 255, 1000, 5553, 20000];

  // (The SSSE3 kernel is one of the four implementations compared.)
  test.skipIf(!meets("x64") || !existsSync(vendor("zlib")) || !existsSync(generated("zlib")))("zlib-ng's checksums", async () => {
    const zlib = vendor("zlib");
    const out = await runProgram(
      "zlib-ng",
      ["arch/generic/adler32_c.c", "arch/generic/crc32_braid_c.c", "arch/x86/adler32_ssse3.c", "arch/generic/crc32_chorba_c.c"].map(f => join(zlib, f)),
      ["ZLIB_COMPAT", "WITH_GZFILEOP", "X86_FEATURES", "X86_SSE2", "X86_SSSE3", "HAVE_BUILTIN_CTZ", "HAVE_BUILTIN_CTZLL"],
      [zlib, join(zlib, "arch/generic"), join(zlib, "arch/x86"), generated("zlib")],
      `#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
uint32_t adler32_c(uint32_t, const uint8_t *, size_t);
uint32_t adler32_ssse3(uint32_t, const uint8_t *, size_t);
uint32_t crc32_braid(uint32_t, const uint8_t *, size_t);
uint32_t crc32_chorba(uint32_t, const uint8_t *, size_t);
${sampleInC}
static unsigned char data[20064];
int main(void) {
  static const size_t lengths[] = { ${lengths.join(", ")} };
  printf("%08x %08x\\n", crc32_braid(0, (const uint8_t *)"123456789", 9), adler32_c(1, (const uint8_t *)"123456789", 9));
  for (int i = 0; i < ${lengths.length}; i++) {
    sample(data, lengths[i]);
    printf("%zu %08x %08x %08x %08x\\n", lengths[i], adler32_c(1, data, lengths[i]), adler32_ssse3(1, data, lengths[i]), crc32_braid(0, data, lengths[i]), crc32_chorba(0, data, lengths[i]));
  }
  return 0;
}
`,
    );
    const hex = (value: number) => value.toString(16).padStart(8, "0");
    const expected = ["cbf43926 091e01de"];
    for (const length of lengths) {
      const data = sample(length);
      const adler = hex(Bun.hash.adler32(data));
      const crc = hex(Bun.hash.crc32(data));
      expected.push(`${length} ${adler} ${adler} ${crc} ${crc}`);
    }
    expect(out).toBe(expected.join("\n") + "\n");
  });

  test.skipIf(!existsSync(vendor("zstd")))("zstd's xxhash", async () => {
    const zstd = vendor("zstd");
    const sizes = [0, 1, 3, 4, 7, 8, 31, 32, 33, 100, 1000];
    const seeds = [0n, 0x9e3779b185ebca87n];
    const out = await runProgram(
      "xxhash",
      [join(zstd, "lib/common/xxhash.c")],
      ["XXH_NAMESPACE=ZSTD_", "ZSTD_DISABLE_ASM=1"],
      [join(zstd, "lib"), join(zstd, "lib/common")],
      `#include <stddef.h>
#include <stdio.h>
unsigned long long ZSTD_XXH64(const void *, size_t, unsigned long long);
unsigned ZSTD_XXH32(const void *, size_t, unsigned);
${sampleInC}
static unsigned char data[1008];
int main(void) {
  static const size_t sizes[] = { ${sizes.join(", ")} };
  for (int i = 0; i < ${sizes.length}; i++) {
    sample(data, sizes[i]);
    printf("%zu %016llx %016llx %08x\\n", sizes[i], ZSTD_XXH64(data, sizes[i], 0), ZSTD_XXH64(data, sizes[i], 0x9e3779b185ebca87ULL), ZSTD_XXH32(data, sizes[i], 0));
  }
  return 0;
}
`,
    );
    const expected = sizes.map(size => {
      const data = sample(size);
      const h64 = seeds.map(seed => Bun.hash.xxHash64(data, seed).toString(16).padStart(16, "0"));
      return `${size} ${h64[0]} ${h64[1]} ${Bun.hash.xxHash32(data, 0).toString(16).padStart(8, "0")}`;
    });
    expect(expected[0]).toBe("0 ef46db3751d8e999 " + expected[0].split(" ")[2] + " 02cc5d05");
    expect(out).toBe(expected.join("\n") + "\n");
  });

  test.skipIf(!existsSync(vendor("hdrhistogram")) || !existsSync(generated("zlib")))("HdrHistogram's percentiles", async () => {
    const hdr = vendor("hdrhistogram");
    const out = await runProgram(
      "hdrhistogram",
      [join(hdr, "src/hdr_histogram.c")],
      ["HDR_NO_AVX2_DISPATCH", "_GNU_SOURCE"],
      [join(hdr, "include"), join(hdr, "src"), generated("zlib")],
      `#include <hdr/hdr_histogram.h>
#include <stdio.h>
int main(void) {
  struct hdr_histogram *h;
  if (hdr_init(1, 3600000000LL, 3, &h)) return 1;
  int ok = 1;
  for (long long v = 1; v <= 10000; v++) ok &= hdr_record_value(h, v);
  printf("%d %lld\\n", ok, (long long)h->total_count);
  printf("%lld %lld %lld %lld\\n", (long long)hdr_value_at_percentile(h, 10.0), (long long)hdr_value_at_percentile(h, 50.0), (long long)hdr_value_at_percentile(h, 99.0), (long long)hdr_value_at_percentile(h, 100.0));
  printf("%lld %lld %.3f\\n", (long long)hdr_min(h), (long long)hdr_max(h), hdr_mean(h));
  return 0;
}
`,
    );
    const [recorded, percentiles, extremes] = out.trim().split("\n").map(line => line.split(" ").map(Number));
    expect(recorded).toEqual([1, 10000]);
    // Three significant digits: values are exact below 2048 and within 0.1% above.
    expect(percentiles[0]).toBe(1000);
    expect(percentiles[1]).toBeWithin(5000, 5004);
    expect(percentiles[2]).toBeWithin(9900, 9908);
    expect(percentiles[3]).toBeWithin(10000, 10008);
    expect(extremes[0]).toBe(1);
    expect(extremes[1]).toBeWithin(10000, 10008);
    expect(Math.abs(extremes[2] - 5000.5)).toBeLessThan(5);
  });

  const roundTripDriver = (include: string, body: string) => `#include ${include}
#include <string.h>
#include <stdio.h>
${sampleInC}
${body}`;

  test.skipIf(!existsSync(vendor("libdeflate")))("libdeflate round trips", async () => {
    const root = vendor("libdeflate");
    const out = await runProgram(
      "libdeflate",
      ["lib/utils.c", "lib/x86/cpu_features.c", "lib/arm/cpu_features.c", "lib/deflate_compress.c", "lib/deflate_decompress.c", "lib/adler32.c", "lib/crc32.c", "lib/zlib_compress.c", "lib/zlib_decompress.c"].map(f => join(root, f)),
      [],
      [root],
      roundTripDriver(
        "<libdeflate.h>",
        `static unsigned char input[20008], packed[70000], unpacked[70000];
static long round_trip(const void *p, size_t n, int level) {
  struct libdeflate_compressor *c = libdeflate_alloc_compressor(level);
  struct libdeflate_decompressor *d = libdeflate_alloc_decompressor();
  if (!c || !d) return -1;
  size_t size = libdeflate_zlib_compress(c, p, n, packed, sizeof packed);
  if (size == 0) return -2;
  size_t actual = 0;
  if (libdeflate_zlib_decompress(d, packed, size, unpacked, sizeof unpacked, &actual) != LIBDEFLATE_SUCCESS) return -3;
  if (actual != n || memcmp(unpacked, p, n) != 0) return -4;
  libdeflate_free_compressor(c);
  libdeflate_free_decompressor(d);
  return (long)size;
}
int main(void) {
  sample(input, 3000);
  printf("%08x %08x\\n", libdeflate_adler32(1, input, 3000), libdeflate_crc32(0, input, 3000));
  for (int level = 1; level <= 6; level += 5) { long size = round_trip(input, 3000, level); printf("%ld %02x %02x\\n", size, packed[0], packed[1]); }
  static const char text[] = "the quick brown fox jumps over the lazy dog. ";
  for (int i = 0; i < 20000; i++) input[i] = text[i % 45];
  printf("%ld\\n", round_trip(input, 20000, 9));
  return 0;
}
`,
      ),
    );
    const lines = out.trim().split("\n");
    const data = sample(3000);
    expect(lines[0]).toBe(`${Bun.hash.adler32(data).toString(16).padStart(8, "0")} ${Bun.hash.crc32(data).toString(16).padStart(8, "0")}`);
    for (const line of lines.slice(1, 3)) {
      const [size, cmf, flg] = line.split(" ");
      expect(Number(size)).toBeWithin(101, 3000);
      // A zlib stream: CMF 0x78, and the header check bits.
      expect(cmf).toBe("78");
      expect((0x78 * 256 + parseInt(flg, 16)) % 31).toBe(0);
    }
    expect(Number(lines[3])).toBeWithin(1, 400);
  });

  // `brotli -q 11` of the text: it uses the static dictionary and its transforms.
  const brotliStream = [
    0x1f, 0x8b, 0x00, 0x00, 0x8c, 0xd4, 0x46, 0xf5, 0xd4, 0x24, 0x05, 0x91, 0xb7, 0x54, 0x2f, 0xa4, 0x0f, 0xf5, 0xb7, 0x9f, 0x09, 0x66, 0x53, 0x3e, 0x44, 0x4f,
    0xd1, 0x08, 0x48, 0xb4, 0xb0, 0x37, 0x37, 0x38, 0xfd, 0xa6, 0x01, 0x79, 0x1b, 0x64, 0x7f, 0x92, 0xd6, 0x55, 0xf7, 0x18, 0x3b, 0x53, 0xc8, 0x71, 0x94, 0x39,
    0x02, 0xce, 0xa8, 0x45, 0x3d, 0xbe, 0xf8, 0xa8, 0x0d, 0xcb, 0xbf, 0xfa, 0x8f, 0xfe, 0x14, 0x5c, 0xec, 0x93, 0xd3, 0x00, 0x4e, 0xb6, 0x82, 0xa6, 0x8e, 0x2a,
    0xe9, 0x52, 0x7d, 0x74, 0x7a, 0x7a, 0x45, 0x49, 0x72, 0x00,
  ];
  const brotliText =
    "the quick brown fox jumps over the lazy dog. The Quick Brown Fox Jumps Over The Lazy Dog? International conference on information technology";

  test.skipIf(!existsSync(vendor("brotli")))("brotli decodes and round trips", async () => {
    const root = vendor("brotli");
    const out = await runProgram(
      "brotli",
      sourcesIn(root, ["c/common", "c/dec", "c/enc"]),
      [],
      [join(root, "c/include")],
      roundTripDriver(
        "<brotli/decode.h>\n#include <brotli/encode.h>",
        `static unsigned char input[6008], packed[1 << 16], unpacked[1 << 16];
static const unsigned char stream[] = { ${bytesInC(brotliStream)} };
static const char text[] = ${JSON.stringify(brotliText)};
static long round_trip(const unsigned char *p, size_t n, int quality) {
  size_t size = sizeof packed;
  if (!BrotliEncoderCompress(quality, 22, BROTLI_MODE_GENERIC, n, p, &size, packed)) return -1;
  size_t back = sizeof unpacked;
  if (BrotliDecoderDecompress(size, packed, &back, unpacked) != BROTLI_DECODER_RESULT_SUCCESS) return -2;
  if (back != n || memcmp(unpacked, p, n) != 0) return -3;
  return (long)size;
}
int main(void) {
  size_t size = sizeof unpacked;
  if (BrotliDecoderDecompress(sizeof stream, stream, &size, unpacked) != BROTLI_DECODER_RESULT_SUCCESS) return 1;
  printf("%zu %.*s\\n", size, (int)size, unpacked);
  printf("%ld %ld %ld\\n", round_trip((const unsigned char *)text, sizeof text - 1, 1), round_trip((const unsigned char *)text, sizeof text - 1, 5), round_trip((const unsigned char *)text, sizeof text - 1, 11));
  sample(input, 6000);
  printf("%ld\\n", round_trip(input, 6000, 4));
  return 0;
}
`,
      ),
    );
    const lines = out.trim().split("\n");
    expect(lines[0]).toBe(`${brotliText.length} ${brotliText}`);
    const sizes = lines[1].split(" ").map(Number);
    for (const size of sizes) expect(size).toBeWithin(41, brotliText.length);
    // The reference encoder gets it down to 88 bytes with the dictionary.
    expect(sizes[2]).toBeLessThanOrEqual(92);
    expect(Number(lines[2])).toBeGreaterThan(1000);
  });

  // `zstd -19` of the text: a raw-literals block with sequences, and a content checksum.
  const zstdStream = [
    0x28, 0xb5, 0x2f, 0xfd, 0x04, 0x68, 0x7d, 0x02, 0x00, 0x04, 0x04, 0x74, 0x68, 0x65, 0x20, 0x71, 0x75, 0x69, 0x63, 0x6b, 0x20, 0x62, 0x72, 0x6f, 0x77, 0x6e,
    0x20, 0x66, 0x6f, 0x78, 0x20, 0x6a, 0x75, 0x6d, 0x70, 0x73, 0x20, 0x6f, 0x76, 0x65, 0x72, 0x20, 0x6c, 0x61, 0x7a, 0x79, 0x20, 0x64, 0x6f, 0x67, 0x2e, 0x20,
    0x20, 0x61, 0x67, 0x61, 0x69, 0x6e, 0x20, 0x61, 0x6e, 0x64, 0x2e, 0x20, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x20, 0x04, 0x00, 0x2e,
    0xdf, 0x6f, 0x41, 0x10, 0x50, 0x19, 0x5a, 0xac, 0xca, 0x09, 0x1b, 0x43, 0xc6, 0x98,
  ];
  const zstdText =
    "the quick brown fox jumps over the lazy dog. the quick brown fox jumps over the lazy dog again and again and again. 0123456789 0123456789 0123456789";

  test.skipIf(!existsSync(vendor("zstd")))("zstd decodes and round trips at levels 1 to 19", async () => {
    const root = vendor("zstd");
    const out = await runProgram(
      "zstd",
      sourcesIn(root, ["lib/common", "lib/compress", "lib/decompress"]),
      ["ZSTD_LEGACY_SUPPORT=0", "ZSTD_DISABLE_ASM=1", "XXH_NAMESPACE=ZSTD_"],
      [join(root, "lib"), join(root, "lib/common")],
      roundTripDriver(
        "<zstd.h>",
        `static unsigned char input[34008], packed[1 << 17], unpacked[1 << 17];
static unsigned char stream[] = { ${bytesInC(zstdStream)} };
static const char text[] = ${JSON.stringify(zstdText)};
static long decode(const void *from, size_t n) {
  size_t size = ZSTD_decompress(unpacked, sizeof unpacked, from, n);
  return ZSTD_isError(size) ? -(long)ZSTD_getErrorCode(size) : (long)size;
}
static long round_trip(const void *p, size_t n, int level) {
  size_t size = ZSTD_compress(packed, sizeof packed, p, n, level);
  if (ZSTD_isError(size)) return -1;
  size_t back = ZSTD_decompress(unpacked, sizeof unpacked, packed, size);
  if (ZSTD_isError(back)) return -2;
  if (back != n || memcmp(unpacked, p, n) != 0) return -3;
  return (long)size;
}
int main(void) {
  long size = decode(stream, sizeof stream);
  printf("%ld %.*s\\n", size, (int)size, unpacked);
  /* A flipped byte fails the checksum (or the block) instead of decoding. */
  stream[20] ^= 1;
  printf("%d\\n", decode(stream, sizeof stream) < 0);
  for (int i = 0; i < 30000; i++) input[i] = text[i % (sizeof text - 1)];
  sample(input + 30000, 4000);
  static const int levels[] = { 1, 3, 9, 19 };
  for (int i = 0; i < 4; i++) printf("%ld\\n", round_trip(input, 34000, levels[i]));
  return 0;
}
`,
      ),
    );
    const lines = out.trim().split("\n");
    expect(lines[0]).toBe(`${zstdText.length} ${zstdText}`);
    expect(lines[1]).toBe("1");
    for (const size of lines.slice(2)) expect(Number(size)).toBeWithin(3001, 6000);
  });

  const sqlite = join(repo, "src/jsc/bindings/sqlite");
  test.skipIf(!existsSync(join(sqlite, "sqlite3.c")))("SQLite runs queries in memory", async () => {
    const queries: [string, string][] = [
      ["select sqlite_version() >= '3.40', 1 + 2 * 3, 7 / 2, 7.0 / 2, 'a' || 'b', upper('hello'), abs(-5)", "1|7|3|3.5|ab|HELLO|5\n"],
      ["create table t(id integer primary key, name text, score real); insert into t(name, score) values ('ann', 9.5), ('bob', 7.25), ('cy', 8.0), ('di', NULL)", ""],
      ["select name, score from t where score > 7.5 order by score desc", "ann|9.5\ncy|8.0\n"],
      ["select count(*), count(score), sum(score), avg(score), max(name), group_concat(name, ',') from t", "4|3|24.75|8.25|di|ann,bob,cy,di\n"],
      ["with recursive n(x) as (select 1 union all select x + 1 from n where x < 100) select sum(x), sum(x * x), count(*) from n", "5050|338350|100\n"],
      ["create index by_name on t(name); select id from t where name = 'cy'; update t set score = score * 2 where id <= 2; select printf('%.2f', sum(score)) from t", "3\n41.50\n"],
      [
        `select json_extract('{"a":[1,2,{"b":42}]}', '$.a[2].b'), json_array(1, 'x', null), round(sqrt(2), 6), 0x7fffffffffffffff + 0, -9223372036854775807 - 1`,
        '42|[1,"x",null]|1.414214|9223372036854775807|-9223372036854775808\n',
      ],
      [
        "select typeof(1), typeof(1.0), typeof('x'), typeof(x'00'), typeof(null), hex(zeroblob(2) || x'ff'), substr('hello', 2, 3), instr('hello', 'll'), replace('aXbX', 'X', '--'), like('a%', 'abc'), glob('a*c', 'abc')",
        "integer|real|text|blob|null|0000FF|ell|3|a--b--|1|1\n",
      ],
      ["select * from nowhere", "error: no such table: nowhere"],
      [
        "begin; insert into t(name) select 'n' || x from (with recursive n(x) as (select 1 union all select x + 1 from n where x < 500) select x from n); commit; select count(*), min(id), max(id) from t",
        "504|1|504\n",
      ],
      ["select name from t where name like 'n49%' order by id", "n49\nn490\nn491\nn492\nn493\nn494\nn495\nn496\nn497\nn498\nn499\n"],
      [
        "create virtual table docs using fts5(body); insert into docs values ('the quick brown fox'), ('lazy dogs sleep'), ('quick thinking'); select rowid from docs where docs match 'quick' order by rowid",
        "1\n3\n",
      ],
      ["pragma integrity_check", "ok\n"],
    ];
    const out = await runProgram(
      "sqlite",
      [join(sqlite, "sqlite3.c")],
      ["SQLITE_THREADSAFE=0", "SQLITE_OMIT_LOAD_EXTENSION=1", "SQLITE_DEFAULT_MEMSTATUS=0", "SQLITE_ENABLE_MATH_FUNCTIONS=1", "SQLITE_ENABLE_JSON1=1", "SQLITE_ENABLE_FTS5=1", "SQLITE_ENABLE_RTREE=1"],
      [sqlite],
      `#include "sqlite3.h"
#include <string.h>
#include <stdio.h>
static sqlite3 *db;
static char out[4096];
static int collect(void *unused, int n, char **values, char **names) {
  (void)unused; (void)names;
  for (int i = 0; i < n; i++) { strcat(out, values[i] ? values[i] : "NULL"); strcat(out, i + 1 < n ? "|" : "\\n"); }
  return 0;
}
static const char *query(const char *sql) {
  char *message = 0;
  out[0] = 0;
  if (sqlite3_exec(db, sql, collect, 0, &message) != SQLITE_OK) snprintf(out, sizeof out, "error: %s", message);
  return out;
}
int main(void) {
  static const char *const queries[] = { ${queries.map(([sql]) => JSON.stringify(sql)).join(",\n    ")} };
  if (sqlite3_open(":memory:", &db)) return 1;
  for (int i = 0; i < ${queries.length}; i++) printf("[%d]%s", i, query(queries[i]));
  return 0;
}
`,
    );
    expect(out).toBe(queries.map(([, result], index) => `[${index}]${result}`).join(""));
  });
});

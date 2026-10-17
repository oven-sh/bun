// Run by s3-moved-store.test.ts, one form in each process:
//   bun s3-moved-store-fixture.ts <form> <key>
// It prints how the S3 call of that form ended, as one line of JSON.
const [form, key] = process.argv.slice(2);

const client = new Bun.S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  bucket: "bucket",
  endpoint: process.env.S3_ENDPOINT,
});
const file = client.file(key);

// Moves the native store out of `file`, into the body of a Response that
// nothing keeps. An array body is a list of Blob parts, which the types of
// Response do not list.
function move() {
  new Response([file] as unknown as Bun.BodyInit);
}

// A collection then frees that store with the Response. The new files take
// the freed memory. Each has a key of its own, as long as `key`.
const others: unknown[] = [];
function moveAndFree() {
  move();
  for (let i = 0; i < 4; i++) Bun.gc(true);
  for (let i = 0; i < 8; i++) others.push(client.file("other-" + i + "-" + Buffer.alloc(200, "z").toString()));
}

function nothing() {}

// Options for unlink(), presign() and writer(). The native method reads the
// property, so `inside` runs in the middle of that method.
const credentials = (inside: () => void) => ({
  get accessKeyId() {
    inside();
    return "test";
  },
});
const method = (inside: () => void) => ({
  get method() {
    inside();
    return "GET" as const;
  },
});
const type = (inside: () => void) => ({
  get type() {
    inside();
    return "text/plain";
  },
});

// unlink() reads the same options as the client. Its types take no argument.
const unlink = (options: Bun.S3Options): Promise<void> => (file as any).unlink(options);
const pathname = (url: string) => new URL(url).pathname;

const forms: Record<string, () => unknown> = {
  // Does `move()` still empty the file? `bucket` reads the store.
  "probe": () => {
    move();
    return file.bucket === undefined;
  },

  // Controls: the store stays in `file`.
  "stat": async () => ({ size: (await file.stat()).size }),
  "unlink": () => unlink(credentials(nothing)).then(() => "deleted"),
  "presign": () => pathname(file.presign(method(nothing))),
  // Control: writer() takes its own reference to the store before a getter runs.
  "writer, a getter moves the store": async () => {
    const writer = file.writer(type(move));
    writer.write("hello");
    return await writer.end();
  },

  "stat, store moved": () => {
    move();
    return file.stat().then(
      stat => ({ size: stat.size }),
      error => ({ rejected: error.code }),
    );
  },
  "unlink, a getter moves the store": () => unlink(credentials(move)).then(() => "deleted"),
  "presign, a getter moves and frees the store": () => pathname(file.presign(method(moveAndFree))),
};

const result = await forms[form]();
console.log(JSON.stringify({ result }));

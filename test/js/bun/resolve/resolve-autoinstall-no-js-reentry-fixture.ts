// Child of resolve-autoinstall-no-js-reentry.test.ts. A Bun.serve handler resolves a
// package that is not installed through the door named in argv, with
// auto-install on, and reports what ran before that call returned.
const doors: Record<string, (name: string) => unknown> = {
  "require": name => require(name),
  "require.resolve": name => require.resolve(name),
  "Bun.resolveSync": name => Bun.resolveSync(name, import.meta.dir),
  "import.meta.resolve": name => import.meta.resolve(name),
  "import.meta.resolveSync": name => import.meta.resolveSync(name),
  // The two asynchronous doors resolve inside the call and only report the
  // failure through the promise.
  "import()": name => void import(name).catch(() => {}),
  "Bun.resolve": name => void Bun.resolve(name, import.meta.dir).catch(() => {}),
};

const door = doors[process.argv[2]];
const packageName = process.argv[3];

let insideTheCall = false;
const ranInsideTheCall: string[] = [];
function record(what: string) {
  if (insideTheCall) ranInsideTheCall.push(what);
}

let requests = 0;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    if (++requests > 1) {
      record("another request");
      return new Response("second");
    }

    setTimeout(() => record("timer"), 0);
    setImmediate(() => record("immediate"));
    process.nextTick(() => record("nextTick"));
    Promise.resolve().then(() => record("microtask"));

    // Nothing may read the request before the call: a read copies the head
    // out of the receive buffer, and the url below has to come from there.
    insideTheCall = true;
    try {
      door(packageName);
    } catch {}
    insideTheCall = false;

    console.log(JSON.stringify({ url: req.url, ranInsideTheCall: ranInsideTheCall.sort() }));
    return new Response("first");
  },
});

console.log(JSON.stringify({ port: server.port }));

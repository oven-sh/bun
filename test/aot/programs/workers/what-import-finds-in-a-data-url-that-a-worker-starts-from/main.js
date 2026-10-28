// import() of a relative path and of a package in the code of a data: URL that a Worker starts from. An executable refuses both on every platform, as Node.js does: such code has
// no folder. ./what-a-text-finds-that-a-worker-starts-from has what it finds, and the other kinds of text. Plain Bun prints another output.
const ask = (what, worker) =>
  new Promise(done => {
    const end = text => (console.log(what + ":", text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), () => end("error")];
  });
const then = '.then(m => postMessage(m.beside ?? m.default ?? m.sep), e => postMessage("refused " + e.code))';

await ask("data: import() of a relative path", new Worker('data:text/javascript,import("./beside.js")' + then));
await ask("data: import() of a path above", new Worker('data:text/javascript,import("../what-import-finds-in-a-data-url-that-a-worker-starts-from/beside.js")' + then));
await ask("data: import() of a package", new Worker('data:text/javascript,import("pkg")' + then));
await ask("data: awaited import() of a relative path", new Worker('data:text/javascript,try { postMessage((await import("./beside.js")).beside) } catch (e) { postMessage("refused " + e.code) }'));

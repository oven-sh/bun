import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

async function run(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, fixture)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("an accessor that a program adds to a prototype of a response gets every store of the constructors", async () => {
  expect(await run("node-http-accessors-added-under-names-that-a-response-stores-fixture.ts")).toEqual({
    stdout: `sendDate on ServerResponse.prototype: made [false true] GET [false true] HEAD [false true]
useChunkedEncodingByDefault on ServerResponse.prototype: made [true true false] GET [true true] HEAD [true true]
finished on ServerResponse.prototype: made [false false] GET [false false true] HEAD [false false true]
destroyed on ServerResponse.prototype: made [false] GET [false true] HEAD [false true]
outputSize on ServerResponse.prototype: made [0] GET [0] HEAD [0]
_last on ServerResponse.prototype: made [false] GET [false] HEAD [false]
_header on ServerResponse.prototype: made [null] GET [null  ] HEAD [null  ]
_sent100 on ServerResponse.prototype: made [false] GET [false] HEAD [false]
req on ServerResponse.prototype: made [object] GET [object] HEAD [object]
statusMessage on ServerResponse.prototype: made [undefined] GET [undefined] HEAD [undefined]
_keepAliveTimeout on ServerResponse.prototype: made [0] GET [0 5000] HEAD [0 5000]
_contentLength on ServerResponse.prototype: made [null] GET [null 2] HEAD [null 0]
outputData on ServerResponse.prototype: made [object] GET [object] HEAD [object]
maxRequestsOnConnectionReached on ServerResponse.prototype: made [false] GET [false] HEAD [false]
_defaultKeepAlive on ServerResponse.prototype: made [true] GET [true] HEAD [true]
_removedTE on ServerResponse.prototype: made [false] GET [false] HEAD [false]
strictContentLength on ServerResponse.prototype: made [false] GET [false] HEAD [false]
_trailer on ServerResponse.prototype: made [] GET [] HEAD []
_headerSent on ServerResponse.prototype: made [false] GET [false] HEAD [false]
_closed on ServerResponse.prototype: made [false] GET [false true] HEAD [false true]
_onPendingData on ServerResponse.prototype: made [function] GET [function] HEAD [function]
_maxListeners on ServerResponse.prototype: made [undefined] GET [undefined] HEAD [undefined]
_eventsCount on ServerResponse.prototype: made [0] GET [0 1] HEAD [0 1]
sendDate on OutgoingMessage.prototype: made [false true] GET [false true] HEAD [false true]
useChunkedEncodingByDefault on OutgoingMessage.prototype: made [true true false] GET [true true] HEAD [true true]
finished on OutgoingMessage.prototype: made [false false] GET [false false true] HEAD [false false true]
_hasBody on OutgoingMessage.prototype: made [] GET [] HEAD []
writable on OutgoingMessage.prototype: made [] GET [] HEAD []
destroyed on OutgoingMessage.prototype: made [false] GET [false true] HEAD [false true]
outputSize on OutgoingMessage.prototype: made [0] GET [0] HEAD [0]
_last on OutgoingMessage.prototype: made [false] GET [false] HEAD [false]
_header on OutgoingMessage.prototype: made [null] GET [null  ] HEAD [null  ]
_sent100 on OutgoingMessage.prototype: made [false] GET [false] HEAD [false]
req on OutgoingMessage.prototype: made [object] GET [object] HEAD [object]
statusMessage on OutgoingMessage.prototype: made [undefined] GET [undefined] HEAD [undefined]
_keepAliveTimeout on OutgoingMessage.prototype: made [0] GET [0 5000] HEAD [0 5000]
_contentLength on OutgoingMessage.prototype: made [null] GET [null 2] HEAD [null 0]
outputData on OutgoingMessage.prototype: made [object] GET [object] HEAD [object]
maxRequestsOnConnectionReached on OutgoingMessage.prototype: made [false] GET [false] HEAD [false]
_defaultKeepAlive on OutgoingMessage.prototype: made [true] GET [true] HEAD [true]
_removedConnection on OutgoingMessage.prototype: made [] GET [] HEAD []
_removedContLen on OutgoingMessage.prototype: made [] GET [] HEAD []
_removedTE on OutgoingMessage.prototype: made [false] GET [false] HEAD [false]
strictContentLength on OutgoingMessage.prototype: made [false] GET [false] HEAD [false]
_trailer on OutgoingMessage.prototype: made [] GET [] HEAD []
_headerSent on OutgoingMessage.prototype: made [false] GET [false] HEAD [false]
_closed on OutgoingMessage.prototype: made [false] GET [false true] HEAD [false true]
_onPendingData on OutgoingMessage.prototype: made [function] GET [function] HEAD [function]
statusCode on OutgoingMessage.prototype: made [] GET [] HEAD []
_maxListeners on OutgoingMessage.prototype: made [undefined] GET [undefined] HEAD [undefined]
_eventsCount on OutgoingMessage.prototype: made [0] GET [0 1] HEAD [0 1]
sendDate on Stream.prototype: made [false true] GET [false true] HEAD [false true]
useChunkedEncodingByDefault on Stream.prototype: made [true true false] GET [true true] HEAD [true true]
finished on Stream.prototype: made [false false] GET [false false true] HEAD [false false true]
_hasBody on Stream.prototype: made [] GET [] HEAD []
writable on Stream.prototype: made [] GET [] HEAD []
destroyed on Stream.prototype: made [false] GET [false true] HEAD [false true]
outputSize on Stream.prototype: made [0] GET [0] HEAD [0]
_last on Stream.prototype: made [false] GET [false] HEAD [false]
_header on Stream.prototype: made [null] GET [null  ] HEAD [null  ]
_sent100 on Stream.prototype: made [false] GET [false] HEAD [false]
req on Stream.prototype: made [object] GET [object] HEAD [object]
statusMessage on Stream.prototype: made [undefined] GET [undefined] HEAD [undefined]
_keepAliveTimeout on Stream.prototype: made [0] GET [0 5000] HEAD [0 5000]
_contentLength on Stream.prototype: made [null] GET [null 2] HEAD [null 0]
outputData on Stream.prototype: made [object] GET [object] HEAD [object]
maxRequestsOnConnectionReached on Stream.prototype: made [false] GET [false] HEAD [false]
_defaultKeepAlive on Stream.prototype: made [true] GET [true] HEAD [true]
_removedConnection on Stream.prototype: made [] GET [] HEAD []
_removedContLen on Stream.prototype: made [] GET [] HEAD []
_removedTE on Stream.prototype: made [false] GET [false] HEAD [false]
strictContentLength on Stream.prototype: made [false] GET [false] HEAD [false]
_trailer on Stream.prototype: made [] GET [] HEAD []
_headerSent on Stream.prototype: made [false] GET [false] HEAD [false]
_closed on Stream.prototype: made [false false] GET [false false true] HEAD [false false true]
_onPendingData on Stream.prototype: made [function] GET [function] HEAD [function]
statusCode on Stream.prototype: made [] GET [] HEAD []
_maxListeners on Stream.prototype: made [undefined undefined] GET [undefined undefined undefined undefined] HEAD [undefined undefined undefined undefined]
_eventsCount on Stream.prototype: made [0] GET [NaN NaN NaN NaN NaN NaN NaN NaN NaN NaN NaN 0 1 NaN NaN NaN] HEAD [NaN NaN NaN NaN NaN NaN NaN NaN NaN NaN NaN 0 1 NaN NaN NaN]
`,
    stderr: "",
    exitCode: 0,
  });
});

test("the constructors of a response store in the order of Node.js", async () => {
  expect(await run("node-http-stores-of-a-response-in-their-order-fixture.ts")).toEqual({
    stdout: `_events _eventsCount _maxListeners outputData outputSize destroyed _last maxRequestsOnConnectionReached _defaultKeepAlive useChunkedEncodingByDefault sendDate _removedTE strictContentLength _contentLength _trailer finished _headerSent _closed _header _keepAliveTimeout _onPendingData req _sent100 statusMessage
made: _events=object _eventsCount=0 _maxListeners=undefined outputData=object outputSize=0 destroyed=false _last=false maxRequestsOnConnectionReached=false _defaultKeepAlive=true useChunkedEncodingByDefault=true sendDate=false _removedTE=false strictContentLength=false _contentLength=null _trailer= finished=false _headerSent=false _closed=false _header=null _keepAliveTimeout=0 _onPendingData=function useChunkedEncodingByDefault=true req=object sendDate=true _sent100=false finished=false useChunkedEncodingByDefault=false statusMessage=undefined
GET: _events=object _eventsCount=0 _maxListeners=undefined outputData=object outputSize=0 destroyed=false _last=false maxRequestsOnConnectionReached=false _defaultKeepAlive=true useChunkedEncodingByDefault=true sendDate=false _removedTE=false strictContentLength=false _contentLength=null _trailer= finished=false _headerSent=false _closed=false _header=null _keepAliveTimeout=0 _onPendingData=function useChunkedEncodingByDefault=true req=object sendDate=true _sent100=false finished=false statusMessage=undefined _keepAliveTimeout=5000 _eventsCount=1
HEAD: _events=object _eventsCount=0 _maxListeners=undefined outputData=object outputSize=0 destroyed=false _last=false maxRequestsOnConnectionReached=false _defaultKeepAlive=true useChunkedEncodingByDefault=true sendDate=false _removedTE=false strictContentLength=false _contentLength=null _trailer= finished=false _headerSent=false _closed=false _header=null _keepAliveTimeout=0 _onPendingData=function useChunkedEncodingByDefault=true req=object sendDate=true _sent100=false finished=false statusMessage=undefined _keepAliveTimeout=5000 _eventsCount=1
`,
    stderr: "",
    exitCode: 0,
  });
});

import { INSPECT_MAX_BYTES } from "buffer";

INSPECT_MAX_BYTES;

{
  new Blob([]);
}
{
  new MessagePort();
}
{
  new MessageChannel();
}
{
  new BroadcastChannel("zxgdfg");
}

{
  new Response("asdf");
}
{
  Response.json({ asdf: "asdf" }).ok;
  const r = Response.json({ hello: "world" });
  r.body;
}

{
  // #40574: with lib.dom loaded, its `composedPath(): EventTarget[]` must win.
  // Without lib.dom, the Node-style tuple type applies.
  const fullPath = [] as EventTarget[];
  fullPath satisfies Bun.__internal.LibDomIsLoaded extends true
    ? ReturnType<Event["composedPath"]>
    : EventTarget[];
  new Event("test").composedPath() satisfies Bun.__internal.LibDomIsLoaded extends true
    ? EventTarget[]
    : [EventTarget?];
}

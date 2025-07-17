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

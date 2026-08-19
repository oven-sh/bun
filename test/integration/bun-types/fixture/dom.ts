import { INSPECT_MAX_BYTES } from "buffer";
import { expectType } from "./utilities";

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
  expectType(new EventSource("http://localhost:3000/events")).is<EventSource>();
  new EventSource(new URL("http://localhost:3000/events"));
  new EventSource("http://localhost:3000/events", { withCredentials: true });
  // @ts-expect-error the url argument is required
  new EventSource();

  expectType(EventSource.CONNECTING).is<0>();
  expectType(EventSource.OPEN).is<1>();
  expectType(EventSource.CLOSED).is<2>();
}

{
  new Response("asdf");
}
{
  Response.json({ asdf: "asdf" }).ok;
  const r = Response.json({ hello: "world" });
  r.body;
}

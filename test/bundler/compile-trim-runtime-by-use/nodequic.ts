import quic from "node:quic";

const endpoint = new quic.QuicEndpoint();
console.log(typeof quic.listen, typeof quic.connect, endpoint.destroyed, endpoint.closing);
await endpoint.close();
console.log(endpoint.destroyed);

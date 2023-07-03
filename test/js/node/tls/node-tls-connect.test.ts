import { TLSSocket, connect } from "tls";

it("should work with alpnProtocols", done => {
  try {
    let socket: TLSSocket | null = connect({
      ALPNProtocols: ["http/1.1"],
      host: "bun.sh",
      servername: "bun.sh",
      port: 443,
      rejectUnauthorized: false,
    });

    const timeout = setTimeout(() => {
      socket?.end();
      done("timeout");
    }, 3000);

    socket.on("error", err => {
      clearTimeout(timeout);
      done(err);
    });

    socket.on("secureConnect", () => {
      clearTimeout(timeout);
      done(socket?.alpnProtocol === "http/1.1" ? undefined : "alpnProtocol is not http/1.1");
      socket?.end();
      socket = null;
    });
  } catch (err) {
    done(err);
  }
});

import dgram from "node:dgram";

// ref() before bind must cancel a pending unref(): the bound socket is then
// the only ref'd handle keeping the event loop alive until the unref'd timer
// fires. Exits 1 if the loop dies before the timer.
const socket = dgram.createSocket("udp4");
socket.unref();
socket.ref();
process.exitCode = 1;
socket.bind(0, () => {
  setTimeout(() => {
    process.exitCode = 0;
    socket.close();
  }, 200).unref();
});

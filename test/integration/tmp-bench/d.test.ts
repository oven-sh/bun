import { bench } from "./run";
bench(
  "cpu.js",
  "ping-pong,keep-alive,http server,one by one,ipc paced,stdin,file.stream,FileSink,createReadStream,64K writes,shell echo",
  "",
);

import { bench } from "./run";
bench("three.js", "busyall.js", "", "stdout,^exec,child,stdin,^spawn,exec,^fork,^ipc", "4", "20");

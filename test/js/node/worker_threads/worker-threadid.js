const wt = require("worker_threads");

wt.postMessage({ threadId: wt.threadId });


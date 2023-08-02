const bc = new BroadcastChannel("hello test");
bc.postMessage("hello from worker");
bc.close();

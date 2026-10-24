const everywhere = globalThis;

everywhere.appVersion = "1.2";
everywhere.appName = ["app"];
everywhere.appStart = port => "started on " + port;
everywhere.App = { retries: null };
everywhere.appOptions = { depth: "deep", extra: 1 };

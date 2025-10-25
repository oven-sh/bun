import { expect, test } from "bun:test";
import { ConfigurationProperty, InstrumentKind, InstrumentRef } from "./types";

test("attach rebuilds inject config for fetch kind", () => {
  using instrument = new InstrumentRef({
    type: InstrumentKind.Fetch,
    name: "test-fetch-inject",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent", "tracestate"],
    },
    onOperationStart() {},
  });

  // Verify global config was updated
  const config = Bun.telemetry
    //@ts-ignore-error
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_fetch_request);
  expect(config).toBeArray();
  expect(config.length).toBe(2);
  expect(config).toContain("traceparent");
  expect(config).toContain("tracestate");
});

test("attach rebuilds inject config for http kind", () => {
  using instrument = new InstrumentRef({
    type: InstrumentKind.HTTP,
    name: "test-http-inject",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent", "x-custom"],
    },
    onOperationStart() {},
  });

  // Verify global config was updated
  const config = Bun.telemetry
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_server_response);
  expect(config).toBeArray();
  expect(config.length).toBe(2);
  expect(config).toContain("traceparent");
  expect(config).toContain("x-custom");
});

test("multiple instruments merge headers linearly", () => {
  using instrument1 = new InstrumentRef({
    type: InstrumentKind.Fetch,
    name: "test-fetch-1",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent", "tracestate"],
    },
    onOperationStart() {},
  });

  using instrument2 = new InstrumentRef({
    type: InstrumentKind.Fetch,
    name: "test-fetch-2",
    version: "1.0.0",
    injectHeaders: {
      request: ["x-request-id", "traceparent"],
    },
    onOperationStart() {},
  });

  // Verify linear concatenation (duplicates allowed)
  const config = Bun.telemetry
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_fetch_request);
  expect(config).toBeArray();
  expect(config.length).toBe(4);
  expect(config[0]).toBe("traceparent");
  expect(config[1]).toBe("tracestate");
  expect(config[2]).toBe("x-request-id");
  expect(config[3]).toBe("traceparent");
});

test("detach rebuilds inject config without detached instrument", () => {
  using instrument1 = new InstrumentRef({
    type: InstrumentKind.Fetch,
    name: "test-fetch-1",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent"],
    },
    onOperationStart() {},
  });

  using instrument2 = new InstrumentRef({
    type: InstrumentKind.Fetch,
    name: "test-fetch-2",
    version: "1.0.0",
    injectHeaders: {
      request: ["x-request-id"],
    },
    onOperationStart() {},
  });

  // Before detach: both headers present
  let config = Bun.telemetry
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_fetch_request);
  expect(config.length).toBe(2);

  // Detach first instrument
  Bun.telemetry.detach(instrument1.id);

  // After detach: only second instrument's header remains
  config = Bun.telemetry
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_fetch_request);
  expect(config).toBeArray();
  expect(config.length).toBe(1);
  expect(config[0]).toBe("x-request-id");
});

test("detaching last instrument clears config", () => {
  {
    using instrument = new InstrumentRef({
      type: InstrumentKind.Fetch,
      name: "test-fetch",
      version: "1.0.0",
      injectHeaders: {
        request: ["traceparent"],
      },
      onOperationStart() {},
    });

    // Config should be set
    let config = Bun.telemetry
      .nativeHooks()
      ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_fetch_request);
    expect(config).toBeArray();
    expect(config.length).toBe(1);
  }

  // After scope exit, config should be undefined
  const config = Bun.telemetry
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_fetch_request);
  expect(config).toBeUndefined();
});

test("instruments without injectHeaders don't affect config", () => {
  using instrument1 = new InstrumentRef({
    type: InstrumentKind.Fetch,
    name: "test-fetch-1",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent"],
    },
    onOperationStart() {},
  });

  using instrument2 = new InstrumentRef({
    type: InstrumentKind.Fetch,
    name: "test-fetch-2",
    version: "1.0.0",
    // No injectHeaders
    onOperationStart() {},
  });

  // Config should only include first instrument's headers
  const config = Bun.telemetry
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_fetch_request);
  expect(config).toBeArray();
  expect(config.length).toBe(1);
  expect(config[0]).toBe("traceparent");
});

test("http and fetch configs are independent", () => {
  using fetchInstrument = new InstrumentRef({
    type: InstrumentKind.Fetch,
    name: "test-fetch",
    version: "1.0.0",
    injectHeaders: {
      request: ["x-fetch-header"],
    },
    onOperationStart() {},
  });

  using httpInstrument = new InstrumentRef({
    type: InstrumentKind.HTTP,
    name: "test-http",
    version: "1.0.0",
    injectHeaders: {
      response: ["x-http-header"],
    },
    onOperationStart() {},
  });

  // Fetch request headers
  const fetchConfig = Bun.telemetry
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_fetch_request);
  expect(fetchConfig).toBeArray();
  expect(fetchConfig.length).toBe(1);
  expect(fetchConfig[0]).toBe("x-fetch-header");

  // HTTP response headers
  const httpConfig = Bun.telemetry
    .nativeHooks()
    ?.getConfigurationProperty(ConfigurationProperty.http_propagate_headers_server_response);
  expect(httpConfig).toBeArray();
  expect(httpConfig.length).toBe(1);
  expect(httpConfig[0]).toBe("x-http-header");
});

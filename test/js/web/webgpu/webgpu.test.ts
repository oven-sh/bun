// What needs no driver.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isAndroid, isCI, isLinux, isMacOS, isWindows } from "harness";

async function run(script: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: { ...bunEnv, ...env }, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const names = Object.getOwnPropertyNames(globalThis).filter(name => /^(GPU|WGSL)/.test(name));
const classes = names.filter(name => typeof globalThis[name] === "function");

describe("interfaces", () => {
  test("have the members of the IDL", () => {
    const describeMember = (prototype: object, key: string) => {
      const { value, set } = Object.getOwnPropertyDescriptor(prototype, key)!;
      return value ? `${key}(${value.length})` : set ? `${key}=` : key;
    };
    const members = (name: string) => {
      const { prototype } = globalThis[name];
      const base = Object.getPrototypeOf(prototype).constructor.name;
      const own = Object.keys(prototype).map(key => describeMember(prototype, key));
      return `${name}(${globalThis[name].length})${base === "Object" ? "" : ` : ${base}`} { ${own.join(" ")} }`;
    };
    expect(classes.toSorted().map(members).join("\n")).toMatchInlineSnapshot(`
      "GPU(0) { requestAdapter(0) getPreferredCanvasFormat(0) wgslLanguageFeatures }
      GPUAdapter(0) { features limits info requestDevice(0) }
      GPUAdapterInfo(0) { vendor architecture device description subgroupMinSize subgroupMaxSize isFallbackAdapter }
      GPUBindGroup(0) { label= }
      GPUBindGroupLayout(0) { label= }
      GPUBuffer(0) { size usage mapState mapAsync(1) getMappedRange(0) unmap(0) destroy(0) label= }
      GPUCommandBuffer(0) { label= }
      GPUCommandEncoder(0) { beginRenderPass(1) beginComputePass(0) copyBufferToBuffer(2) copyBufferToTexture(3) copyTextureToBuffer(3) copyTextureToTexture(3) clearBuffer(1) resolveQuerySet(5) finish(0) label= pushDebugGroup(1) popDebugGroup(0) insertDebugMarker(1) }
      GPUCompilationInfo(0) { messages }
      GPUCompilationMessage(0) { message type lineNum linePos offset length }
      GPUComputePassEncoder(0) { setPipeline(1) dispatchWorkgroups(1) dispatchWorkgroupsIndirect(2) end(0) label= pushDebugGroup(1) popDebugGroup(0) insertDebugMarker(1) setBindGroup(2) setImmediates(2) }
      GPUComputePipeline(0) { label= getBindGroupLayout(1) }
      GPUDevice(0) : EventTarget { features limits adapterInfo queue destroy(0) createBuffer(1) createTexture(1) createSampler(0) createBindGroupLayout(1) createPipelineLayout(1) createBindGroup(1) createShaderModule(1) createComputePipeline(1) createRenderPipeline(1) createComputePipelineAsync(1) createRenderPipelineAsync(1) createCommandEncoder(0) createRenderBundleEncoder(1) createQuerySet(1) label= lost pushErrorScope(1) popErrorScope(0) onuncapturederror= }
      GPUDeviceLostInfo(0) { reason message }
      GPUError(0) { message }
      GPUExternalTexture(0) { label= }
      GPUInternalError(1) : GPUError {  }
      GPUOutOfMemoryError(1) : GPUError {  }
      GPUPipelineError(2) : DOMException { reason }
      GPUPipelineLayout(0) { label= }
      GPUQuerySet(0) { destroy(0) type count label= }
      GPUQueue(0) { submit(1) onSubmittedWorkDone(0) writeBuffer(3) writeTexture(4) label= }
      GPURenderBundle(0) { label= }
      GPURenderBundleEncoder(0) { finish(0) label= pushDebugGroup(1) popDebugGroup(0) insertDebugMarker(1) setBindGroup(2) setImmediates(2) setPipeline(1) setIndexBuffer(2) setVertexBuffer(2) draw(1) drawIndexed(1) drawIndirect(2) drawIndexedIndirect(2) }
      GPURenderPassEncoder(0) { setViewport(6) setScissorRect(4) setBlendConstant(1) setStencilReference(1) beginOcclusionQuery(1) endOcclusionQuery(0) executeBundles(1) end(0) label= pushDebugGroup(1) popDebugGroup(0) insertDebugMarker(1) setBindGroup(2) setImmediates(2) setPipeline(1) setIndexBuffer(2) setVertexBuffer(2) draw(1) drawIndexed(1) drawIndirect(2) drawIndexedIndirect(2) }
      GPURenderPipeline(0) { label= getBindGroupLayout(1) }
      GPUSampler(0) { label= }
      GPUShaderModule(0) { getCompilationInfo(0) label= }
      GPUSupportedFeatures(0) { size entries(0) forEach(1) has(1) values(0) keys(0) }
      GPUSupportedLimits(0) { maxTextureDimension1D maxTextureDimension2D maxTextureDimension3D maxTextureArrayLayers maxBindGroups maxBindGroupsPlusVertexBuffers maxImmediateSize maxBindingsPerBindGroup maxDynamicUniformBuffersPerPipelineLayout maxDynamicStorageBuffersPerPipelineLayout maxSampledTexturesPerShaderStage maxSamplersPerShaderStage maxStorageBuffersPerShaderStage maxStorageBuffersInVertexStage maxStorageBuffersInFragmentStage maxStorageTexturesPerShaderStage maxStorageTexturesInVertexStage maxStorageTexturesInFragmentStage maxUniformBuffersPerShaderStage maxUniformBufferBindingSize maxStorageBufferBindingSize minUniformBufferOffsetAlignment minStorageBufferOffsetAlignment maxVertexBuffers maxBufferSize maxVertexAttributes maxVertexBufferArrayStride maxInterStageShaderVariables maxColorAttachments maxColorAttachmentBytesPerSample maxComputeWorkgroupStorageSize maxComputeInvocationsPerWorkgroup maxComputeWorkgroupSizeX maxComputeWorkgroupSizeY maxComputeWorkgroupSizeZ maxComputeWorkgroupsPerDimension }
      GPUTexture(0) { createView(0) destroy(0) width height depthOrArrayLayers mipLevelCount sampleCount dimension format usage textureBindingViewDimension label= }
      GPUTextureView(0) { label= }
      GPUUncapturedErrorEvent(2) : Event { error }
      GPUValidationError(1) : GPUError {  }
      WGSLLanguageFeatures(0) { size entries(0) forEach(1) has(1) values(0) keys(0) }"
    `);
  });

  test.each(classes)("%s has the shape WebIDL gives an interface", name => {
    const constructor = globalThis[name];
    const { prototype } = constructor;
    const base = Object.getPrototypeOf(prototype).constructor;
    expect({
      global: Object.getOwnPropertyDescriptor(globalThis, name),
      name: constructor.name,
      base: Object.getPrototypeOf(constructor),
      prototype: Object.getOwnPropertyDescriptor(constructor, "prototype"),
      constructor: Object.getOwnPropertyDescriptor(prototype, "constructor"),
      toStringTag: Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag),
    }).toEqual({
      global: { value: constructor, writable: true, enumerable: false, configurable: true },
      name,
      base: base === Object ? Function.prototype : base,
      prototype: { value: prototype, writable: false, enumerable: false, configurable: false },
      constructor: { value: constructor, writable: true, enumerable: false, configurable: true },
      toStringTag: { value: name, writable: false, enumerable: false, configurable: true },
    });
    expect(() => constructor()).toThrow(TypeError);
    expect(() => new constructor()).toThrow(TypeError);
  });

  test.each(classes)("the members of %s refuse another receiver", async name => {
    const { prototype } = globalThis[name];
    for (const key of Object.keys(prototype)) {
      const { value, get, set, configurable, writable } = Object.getOwnPropertyDescriptor(prototype, key)!;
      expect({ key, configurable, writable }).toEqual({ key, configurable: true, writable: value ? true : undefined });
      for (const member of [value, get, set].filter(Boolean)) {
        for (const receiver of [
          undefined,
          {},
          prototype,
          name === "GPU" ? new GPUValidationError("") : navigator.gpu,
        ]) {
          expect({ key, error: await (async () => member.call(receiver, ""))().catch(error => error) }).toEqual({
            key,
            error: expect.any(TypeError),
          });
        }
      }
    }
  });

  test("what returns a promise rejects it and does not throw", async () => {
    const promises = [
      GPU.prototype.requestAdapter(),
      GPUAdapter.prototype.requestDevice(),
      GPUBuffer.prototype.mapAsync(GPUMapMode.READ),
      GPUDevice.prototype.createComputePipelineAsync({} as any),
      GPUDevice.prototype.createRenderPipelineAsync({} as any),
      GPUDevice.prototype.lost,
      GPUDevice.prototype.popErrorScope(),
      GPUQueue.prototype.onSubmittedWorkDone(),
      GPUShaderModule.prototype.getCompilationInfo(),
    ];
    expect(await Promise.allSettled(promises)).toEqual(
      promises.map(() => ({ status: "rejected", reason: expect.any(TypeError) })),
    );
  });
});

test("namespaces", () => {
  const namespaces = names.filter(name => !classes.includes(name));
  expect(Object.fromEntries(namespaces.map(name => [name, { ...globalThis[name] }]))).toEqual({
    GPUBufferUsage: {
      MAP_READ: 0x1,
      MAP_WRITE: 0x2,
      COPY_SRC: 0x4,
      COPY_DST: 0x8,
      INDEX: 0x10,
      VERTEX: 0x20,
      UNIFORM: 0x40,
      STORAGE: 0x80,
      INDIRECT: 0x100,
      QUERY_RESOLVE: 0x200,
    },
    GPUColorWrite: { RED: 0x1, GREEN: 0x2, BLUE: 0x4, ALPHA: 0x8, ALL: 0xf },
    GPUMapMode: { READ: 0x1, WRITE: 0x2 },
    GPUShaderStage: { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 },
    GPUTextureUsage: {
      COPY_SRC: 0x1,
      COPY_DST: 0x2,
      TEXTURE_BINDING: 0x4,
      STORAGE_BINDING: 0x8,
      RENDER_ATTACHMENT: 0x10,
      TRANSIENT_ATTACHMENT: 0x20,
    },
  });
  for (const name of namespaces) expect(String(globalThis[name])).toBe(`[object ${name}]`);
  expect(Object.getOwnPropertyDescriptor(GPUMapMode, "READ")).toEqual({
    value: 1,
    writable: false,
    enumerable: true,
    configurable: false,
  });
});

describe("constructors", () => {
  test.each([GPUValidationError, GPUOutOfMemoryError, GPUInternalError])("%p", Class => {
    const error = new Class("message");
    expect(error).toBeInstanceOf(Class);
    expect(error).toBeInstanceOf(GPUError);
    expect(error).not.toBeInstanceOf(Error);
    expect(error.message).toBe("message");
    expect(new Class(undefined as any).message).toBe("undefined");

    class Subclass extends Class {}
    expect(new Subclass("sub")).toBeInstanceOf(Subclass);
    expect(new Subclass("sub").message).toBe("sub");
  });

  test("GPUPipelineError", () => {
    const error = new GPUPipelineError("message", { reason: "internal" });
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toBeInstanceOf(Error);
    expect({ name: error.name, message: error.message, code: error.code, reason: error.reason }).toEqual({
      name: "GPUPipelineError",
      message: "message",
      code: 0,
      reason: "internal",
    });
    expect(new GPUPipelineError(undefined, { reason: "validation" }).message).toBe("");
    expect(() => new GPUPipelineError("", {} as any)).toThrow(TypeError);
    expect(() => new GPUPipelineError("", { reason: "other" as any })).toThrow(TypeError);
  });

  test("GPUUncapturedErrorEvent", () => {
    const event = new GPUUncapturedErrorEvent("type", { error: new GPUValidationError("kept"), cancelable: true });
    Bun.gc(true);
    expect(event).toBeInstanceOf(Event);
    expect(event.error).toBe(event.error);
    expect({
      type: event.type,
      message: event.error.message,
      cancelable: event.cancelable,
      bubbles: event.bubbles,
      isTrusted: event.isTrusted,
    }).toEqual({ type: "type", message: "kept", cancelable: true, bubbles: false, isTrusted: false });

    const target = new EventTarget();
    const seen: Event[] = [];
    target.addEventListener("type", event => (seen.push(event), event.preventDefault()));
    expect(target.dispatchEvent(event)).toBe(false);
    expect(seen[0]).toBe(event);

    expect(() => new GPUUncapturedErrorEvent("type", {} as any)).toThrow(TypeError);
    expect(() => new GPUUncapturedErrorEvent("type", { error: new Error() })).toThrow(TypeError);
  });
});

describe("navigator.gpu", () => {
  test("is one object", () => {
    expect(navigator.gpu).toBeInstanceOf(GPU);
    expect(navigator.gpu).toBe(navigator.gpu);
    expect(Object.create(navigator).gpu).toBe(navigator.gpu);
  });

  test("getPreferredCanvasFormat()", () => {
    expect(navigator.gpu.getPreferredCanvasFormat()).toBe(isAndroid ? "rgba8unorm" : "bgra8unorm");
  });

  test("wgslLanguageFeatures is a read-only set", () => {
    const features = navigator.gpu.wgslLanguageFeatures;
    const values = [...features];
    expect(features).toBe(navigator.gpu.wgslLanguageFeatures);
    expect(values).toContain("packed_4x8_integer_dot_product");
    expect(values.filter(value => value.startsWith("chromium"))).toEqual([]);
    expect(features.size).toBe(values.length);
    expect(features.has(values[0])).toBe(true);
    expect(features.has("nothing")).toBe(false);
    expect([...features.keys()]).toEqual(values);
    expect([...features.entries()]).toEqual(values.map(value => [value, value]));
    expect(new Set(values).isSubsetOf(features)).toBe(true);
  });

  test("requestAdapter() converts its options", async () => {
    expect(await navigator.gpu.requestAdapter({ featureLevel: "other" })).toBeNull();
    await expect(navigator.gpu.requestAdapter({ powerPreference: "other" as any })).rejects.toThrow(TypeError);
    await expect(navigator.gpu.requestAdapter(1 as any)).rejects.toThrow(TypeError);
  });

  test.skipIf(!isCI || !(isMacOS || isWindows))("the system has a driver", async () => {
    expect(await navigator.gpu.requestAdapter()).toBeInstanceOf(GPUAdapter);
  });

  describe.concurrent("in a new process", () => {
    test.each([
      [
        "looks like a data property before it is read",
        `const { value, ...rest } = Object.getOwnPropertyDescriptor(navigator, "gpu"); console.log(String(value), JSON.stringify(rest))`,
        `[object GPU] {"writable":true,"enumerable":true,"configurable":true}`,
      ],
      ["can be assigned before it is read", `navigator.gpu = 1; console.log(navigator.gpu)`, "1"],
      ["can be assigned after it is read", `navigator.gpu; navigator.gpu = 1; console.log(navigator.gpu)`, "1"],
      ["can be deleted", `delete navigator.gpu; console.log("gpu" in navigator)`, "false"],
      ["can be defined", `Object.defineProperty(navigator, "gpu", { get: () => 1 }); console.log(navigator.gpu)`, "1"],
      [
        "stays frozen",
        `Object.freeze(navigator); console.log(navigator.gpu === navigator.gpu, Object.isFrozen(navigator), Reflect.set(navigator, "gpu", 1))`,
        "true true false",
      ],
      [
        "is first read through an object that inherits it",
        `const child = Object.create(navigator); console.log(child.gpu === navigator.gpu, Object.hasOwn(child, "gpu"))`,
        "true false",
      ],
    ])("%s", async (_, script, expected) => {
      expect(await run(script)).toEqual({ stdout: expected + "\n", stderr: "", exitCode: 0 });
    });

    test.skipIf(isMacOS || isWindows)("without a driver there is no adapter, and nothing is printed", async () => {
      const script = `console.log(await navigator.gpu.requestAdapter(), await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }))`;
      expect(
        await run(script, { VK_DRIVER_FILES: "/nonexistent.json", VK_ICD_FILENAMES: "/nonexistent.json" }),
      ).toEqual({ stdout: "null null\n", stderr: "", exitCode: 0 });
    });

    test.skipIf(!isLinux)("nothing but requestAdapter() loads Vulkan", async () => {
      const script = `
        navigator.gpu.wgslLanguageFeatures, navigator.gpu.getPreferredCanvasFormat(), new GPUValidationError("");
        console.log(require("fs").readFileSync("/proc/self/maps", "latin1").includes("libvulkan"));`;
      expect(await run(script)).toEqual({ stdout: "false\n", stderr: "", exitCode: 0 });
    });
  });
});

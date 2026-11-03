const path = require("node:path");

module.exports = debugMode => {
  const addonPath = path.join(__dirname, "build", debugMode ? "Debug" : "Release", "v8tests.node");
  const nativeModule = require(addonPath);

  // For the tests that wrap the addon's memory, which has a counting deleter per slot.
  const deleterCalls = slot => nativeModule.wrapped_memory_deleter_calls()[slot];
  const describeDeleters = (firstSlot, count) => {
    const calls = nativeModule.wrapped_memory_deleter_calls().slice(firstSlot, firstSlot + count);
    const ran = calls.filter(n => n > 0).length;
    return `${ran} of ${count} ran, ${calls.filter(n => n > 1).length} more than once`;
  };
  const describeBuffer = buffer => `byteLength = ${buffer.byteLength}, detached = ${buffer.detached}`;

  // As uWebSockets.js does with a body chunk: the addon lends a buffer over its memory to a handler and calls Detach()
  // when the handler returns. One case after the other, so that the lines come in one order.
  const lendToHandlers = (cases, afterJob = () => {}, afterDetach = () => {}) => {
    const lend = slot => {
      if (slot === cases.length) return;
      const [description, handler] = cases[slot];
      console.log(`====== ${description}`);
      let lent, lentView;
      nativeModule.lend_wrapped_buffer(slot, buffer => {
        lent = buffer;
        lentView = new Uint8Array(buffer);
        handler(buffer, lentView, () => {
          console.log("after the handler's job:", describeBuffer(lent));
          afterJob(lent, lentView, slot);
          lend(slot + 1);
        });
      });
      console.log("after Detach():", describeBuffer(lent), "view length =", lentView.length);
      console.log("deleter calls after Detach() =", deleterCalls(slot));
      afterDetach(lentView, slot);
    };
    lend(0);
  };

  // Runs `script` in a Worker that has the addon as `nativeModule`, then `afterExit` in this thread.
  const runInWorker = (script, afterExit) => {
    const { Worker } = require("node:worker_threads");
    const worker = new Worker(`const nativeModule = require(${JSON.stringify(addonPath)});\n${script}`, { eval: true });
    worker.once("error", error => {
      throw error;
    });
    worker.once("exit", afterExit);
  };

  return {
    ...nativeModule,

    test_v8_function_script_origin() {
      function namedFunction(a, b) {
        return a + b;
      }
      const arrowFunction = (a, b) => a + b;
      class DefaultConstructor {
        method() {}
      }
      class ExplicitConstructor {
        constructor() {}
      }
      class Derived extends DefaultConstructor {}
      const AnonymousClass = class {};
      const cases = [
        ["named function", namedFunction],
        ["arrow function", arrowFunction],
        ["class with default constructor", DefaultConstructor],
        ["class with explicit constructor", ExplicitConstructor],
        ["derived class with default constructor", Derived],
        ["anonymous class expression", AnonymousClass],
        ["class method", DefaultConstructor.prototype.method],
        ["builtin function", Array.prototype.map],
        ["bound function", namedFunction.bind(null)],
        ["native addon function", nativeModule.get_function_script_origin],
      ];
      for (const [description, fn] of cases) {
        console.log(`====== ${description}`);
        const { file, line, column } = nativeModule.get_function_script_origin(fn);
        console.log("file:", typeof file === "string" ? path.basename(file) : file);
        console.log("file is absolute:", typeof file === "string" && path.isAbsolute(file));
        console.log("line:", line, "column:", column);
      }
    },

    test_v8_value_external_and_buffer_type_checks() {
      const [external, templateInstance] = nativeModule.create_external_and_template_instance();
      const detached = new ArrayBuffer(8);
      const viewOfDetached = new Uint8Array(detached);
      detached.transfer();
      const { proxy: revokedProxy, revoke } = Proxy.revocable(new ArrayBuffer(8), {});
      revoke();
      const typedArrays = [
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float16Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array,
      ];
      const cases = [
        ["ArrayBuffer", new ArrayBuffer(8)],
        ["resizable ArrayBuffer", new ArrayBuffer(8, { maxByteLength: 16 })],
        ["detached ArrayBuffer", detached],
        ["ArrayBuffer subclass instance", new (class extends ArrayBuffer {})(8)],
        ["WebAssembly.Memory buffer", new WebAssembly.Memory({ initial: 1 }).buffer],
        ["SharedArrayBuffer", new SharedArrayBuffer(8)],
        ["growable SharedArrayBuffer", new SharedArrayBuffer(8, { maxByteLength: 16 })],
        ["SharedArrayBuffer subclass instance", new (class extends SharedArrayBuffer {})(8)],
        ["shared WebAssembly.Memory buffer", new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer],
        ...typedArrays.map(TypedArray => [TypedArray.name, new TypedArray(2)]),
        ["Uint8Array subclass instance", new (class extends Uint8Array {})(2)],
        ["Uint8Array over a SharedArrayBuffer", new Uint8Array(new SharedArrayBuffer(8))],
        ["Uint8Array over a resizable ArrayBuffer", new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }))],
        ["Uint8Array over a detached ArrayBuffer", viewOfDetached],
        ["Buffer", Buffer.from("hello")],
        ["DataView over an ArrayBuffer", new DataView(new ArrayBuffer(8))],
        ["DataView over a SharedArrayBuffer", new DataView(new SharedArrayBuffer(8))],
        ["DataView over a resizable ArrayBuffer", new DataView(new ArrayBuffer(8, { maxByteLength: 16 }))],
        ["DataView subclass instance", new (class extends DataView {})(new ArrayBuffer(8))],
        ["External", external],
        ["ObjectTemplate instance with internal fields", templateInstance],
        ["Proxy of an ArrayBuffer", new Proxy(new ArrayBuffer(8), {})],
        ["Proxy of a SharedArrayBuffer", new Proxy(new SharedArrayBuffer(8), {})],
        ["Proxy of a Uint8Array", new Proxy(new Uint8Array(2), {})],
        ["Proxy of a DataView", new Proxy(new DataView(new ArrayBuffer(8)), {})],
        ["Proxy of an External", new Proxy(external, {})],
        ["revoked Proxy of an ArrayBuffer", revokedProxy],
        ["object whose prototype is ArrayBuffer.prototype", Object.create(ArrayBuffer.prototype)],
        ["plain object", {}],
        ["array", [1, 2, 3]],
        ["function", function () {}],
        ["undefined", undefined],
        ["null", null],
        ["true", true],
        ["false", false],
        ["int32", 42],
        ["double", 1.5],
        ["string", "ArrayBuffer"],
        ["bigint", 123n],
        ["symbol", Symbol("ArrayBuffer")],
      ];
      for (const [description, value] of cases) {
        nativeModule.print_external_and_buffer_type_checks(value, description);
      }
    },

    test_v8_value_to_int32() {
      const cases = [
        ["int", 42],
        ["negative int", -7],
        ["fraction", 3.99],
        ["negative fraction", -3.99],
        ["INT32_MAX + 1", 2 ** 31],
        ["UINT32_MAX + 6", 2 ** 32 + 5],
        ["INT32_MIN - 1", -(2 ** 31) - 1],
        ["NaN", NaN],
        ["Infinity", Infinity],
        ["numeric string", "123"],
        ["hex string", "0x10"],
        ["true", true],
        ["null", null],
        ["undefined", undefined],
        ["object with valueOf", { valueOf: () => 77.5 }],
        [
          "object with throwing valueOf",
          {
            valueOf() {
              throw new Error("valueOf threw");
            },
          },
        ],
      ];
      for (const [description, value] of cases) {
        console.log(`====== ${description}`);
        try {
          console.log("result:", nativeModule.perform_to_int32(value));
        } catch (e) {
          console.log("threw:", e.message);
        }
      }
    },

    // Bun only: 48k collected instances with 128 internal fields each. Their
    // field storage is about 2 KB per instance, 100 MiB if none of it is freed.
    test_v8_internal_field_object_leak() {
      nativeModule.create_objects_with_internal_fields(256, 128);
      Bun.gc(true);
      const before = process.memoryUsage.rss();
      for (let i = 0; i < 24; i++) {
        nativeModule.create_objects_with_internal_fields(2000, 128);
        Bun.gc(true);
      }
      const after = process.memoryUsage.rss();
      console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
    },

    test_v8_global() {
      console.log("global initial value =", nativeModule.global_get());

      nativeModule.global_set(123);
      console.log("global after setting to 123 =", nativeModule.global_get());

      nativeModule.global_set({ foo: 5, bar: ["one", "two", "three"] });
      if (process.isBun) {
        Bun.gc(true);
      }
      console.log("global after setting to object =", JSON.stringify(nativeModule.global_get()));

      nativeModule.global_set(true);
      console.log("global after setting to true =", nativeModule.global_get());
    },

    test_v8_function_template() {
      const f = nativeModule.create_function_with_data();
      if (process.isBun) {
        Bun.gc(true);
      }
      console.log(f());
    },

    test_v8_function_template_set_class_name() {
      const f = nativeModule.test_v8_function_template_set_class_name();
      console.log("f.name =", f.name);
    },

    test_v8_define_own_property() {
      const obj = nativeModule.test_v8_define_own_property();
      for (const key of ["writable", "readonly", "hidden"]) {
        const d = Object.getOwnPropertyDescriptor(obj, key);
        console.log(
          key,
          "=",
          d.value,
          "writable =",
          d.writable,
          "enumerable =",
          d.enumerable,
          "configurable =",
          d.configurable,
        );
      }
      console.log("enumerable keys =", JSON.stringify(Object.keys(obj).sort()));
    },

    test_v8_bigint() {
      const big = nativeModule.test_v8_bigint();
      console.log("typeof =", typeof big);
      console.log("value =", big.toString());
      console.log("is expected =", big === 123456789012345n);
    },

    test_v8_bigint_new_from_unsigned() {
      const print = bigints => {
        for (const big of bigints) console.log("typeof =", typeof big, "value =", big.toString());
      };
      print(nativeModule.create_bigints_from_unsigned());
      // Bun calls a constructor under an exception scope, where JSC's validation aborts if the shim skips a check.
      print(new nativeModule.create_bigints_from_unsigned());
      try {
        nativeModule.create_bigints_from_unsigned_with_pending_exception();
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.message);
      }
    },

    test_v8_prototype_template() {
      const inst = nativeModule.test_v8_prototype_template();
      console.log("protoMethod() =", inst.protoMethod());
      console.log("nativeProp =", inst.nativeProp);
      console.log("protoMethod is own =", Object.prototype.hasOwnProperty.call(inst, "protoMethod"));
    },

    test_v8_arraybuffer_accessors() {
      const fill = buffer => {
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
        return buffer;
      };
      // The native side writes 0xee to the last byte through Data(), so this shows that Data() is not a copy.
      const show = (description, buffer, describe) => {
        console.log(`====== ${description}`);
        console.log(describe(buffer));
        if (buffer.byteLength > 0) console.log("last byte seen from JS =", new Uint8Array(buffer).at(-1));
      };
      const showArrayBuffer = (description, buffer) => show(description, buffer, nativeModule.describe_array_buffer);
      const showShared = (description, buffer) => show(description, buffer, nativeModule.describe_shared_array_buffer);

      showArrayBuffer("ArrayBuffer(8)", fill(new ArrayBuffer(8)));
      const transferred = fill(new ArrayBuffer(8));
      transferred.transfer();
      showArrayBuffer("ArrayBuffer(8) detached by transfer()", transferred);
      const resizable = fill(new ArrayBuffer(4, { maxByteLength: 16 }));
      showArrayBuffer("resizable ArrayBuffer, 4 of 16 bytes", resizable);
      resizable.resize(12);
      showArrayBuffer("resizable ArrayBuffer grown to 12 bytes", resizable);
      const offsetView = new Uint8Array(fill(new ArrayBuffer(8)), 2, 4);
      showArrayBuffer("the buffer of a Uint8Array over bytes 2..6 of an ArrayBuffer", offsetView.buffer);
      const fromArray = new Uint8Array([5, 6, 7]);
      showArrayBuffer("the buffer of a Uint8Array made from an array", fromArray.buffer);
      console.log("last byte seen through the Uint8Array =", fromArray.at(-1));
      showArrayBuffer("WebAssembly.Memory buffer", new WebAssembly.Memory({ initial: 1 }).buffer);

      showShared("SharedArrayBuffer(8)", fill(new SharedArrayBuffer(8)));
      const growable = fill(new SharedArrayBuffer(4, { maxByteLength: 16 }));
      showShared("growable SharedArrayBuffer, 4 of 16 bytes", growable);
      growable.grow(8);
      showShared("growable SharedArrayBuffer grown to 8 bytes", growable);
      const sharedOffsetView = new Uint8Array(fill(new SharedArrayBuffer(8)), 4);
      showShared("the buffer of a Uint8Array over bytes 4..8 of a SharedArrayBuffer", sharedOffsetView.buffer);

      // The native side writes 0xdd to the first byte of the view.
      const showView = (description, view) => {
        console.log(`====== ${description}`);
        console.log(nativeModule.describe_array_buffer_view_bytes(view));
        if (view.byteLength > 0) {
          console.log("first byte seen from JS =", new Uint8Array(view.buffer, view.byteOffset, 1)[0]);
        }
      };
      showView("Uint8Array over bytes 2..6 of an ArrayBuffer", new Uint8Array(fill(new ArrayBuffer(8)), 2, 4));
      showView("DataView over bytes 3..5 of an ArrayBuffer", new DataView(fill(new ArrayBuffer(8)), 3, 2));
      showView("Uint8Array made from an array", new Uint8Array([5, 6, 7]));
      showView("Uint16Array", new Uint16Array([0x0201, 0x0403]));
      const large = new Uint8Array(2000);
      large.set([9, 8, 7, 6]);
      showView("Uint8Array(2000)", large);
      showView("Buffer", Buffer.from("abcd"));
      showView("Uint8Array over bytes 4..8 of a SharedArrayBuffer", new Uint8Array(fill(new SharedArrayBuffer(8)), 4));
      showView(
        "length-tracking Uint8Array from byte 2 of a resizable ArrayBuffer",
        new Uint8Array(fill(new ArrayBuffer(6, { maxByteLength: 16 })), 2),
      );
      showView("empty Uint8Array", new Uint8Array(0));
    },

    test_v8_arraybuffer_detach() {
      console.log("====== ArrayBuffer(8) with views");
      const buffer = new ArrayBuffer(8);
      const bytes = new Uint8Array(buffer);
      bytes.set([1, 2, 3, 4, 5, 6, 7, 8]);
      const tail = new Uint8Array(buffer, 2, 4);
      const dataView = new DataView(buffer, 2, 4);
      console.log(nativeModule.detach_array_buffer(buffer));
      console.log("byteLength =", buffer.byteLength, "detached =", buffer.detached);
      console.log("Uint8Array: length =", bytes.length, "byteOffset =", bytes.byteOffset, "[0] =", bytes[0]);
      console.log("Uint8Array at offset 2: length =", tail.length, "byteOffset =", tail.byteOffset);
      for (const [description, use] of [
        ["DataView read", () => dataView.getUint8(0)],
        ["new Uint8Array(buffer)", () => new Uint8Array(buffer)],
        ["slice()", () => buffer.slice(0)],
      ]) {
        try {
          use();
          console.log(`${description}: did not throw`);
        } catch (e) {
          console.log(`${description}: threw ${e.constructor.name}`);
        }
      }
      console.log(nativeModule.describe_array_buffer(buffer));

      console.log("====== the same buffer again");
      console.log(nativeModule.detach_array_buffer(buffer));
      console.log("byteLength =", buffer.byteLength, "detached =", buffer.detached);

      console.log("====== ArrayBuffer(0)");
      const empty = new ArrayBuffer(0);
      console.log(nativeModule.detach_array_buffer(empty));
      console.log("detached =", empty.detached);

      console.log("====== resizable ArrayBuffer");
      const resizable = new ArrayBuffer(4, { maxByteLength: 16 });
      const tracking = new Uint8Array(resizable);
      console.log(nativeModule.detach_array_buffer(resizable));
      console.log("byteLength =", resizable.byteLength, "maxByteLength =", resizable.maxByteLength);
      console.log("detached =", resizable.detached, "resizable =", resizable.resizable);
      console.log("length-tracking Uint8Array: length =", tracking.length);

      console.log("====== ArrayBuffer that transfer() already detached");
      const transferred = new ArrayBuffer(8);
      transferred.transfer();
      console.log(nativeModule.detach_array_buffer(transferred));
      console.log("detached =", transferred.detached);

      console.log("====== the buffer of a Uint8Array made from an array");
      const fromArray = new Uint8Array([5, 6, 7]);
      console.log(nativeModule.detach_array_buffer(fromArray.buffer));
      console.log("Uint8Array: length =", fromArray.length, "[0] =", fromArray[0]);

      console.log("====== the buffer of a Uint8Array(2000)");
      const large = new Uint8Array(2000);
      console.log(nativeModule.detach_array_buffer(large.buffer));
      console.log("Uint8Array: length =", large.length, "[0] =", large[0]);

      console.log("====== ArrayBuffer(8) whose store the addon keeps");
      const kept = new ArrayBuffer(8);
      new Uint8Array(kept).set([1, 2, 3, 4, 5, 6, 7, 8]);
      console.log(nativeModule.read_store_after_detach(kept));

      console.log("====== ArrayBuffer(8) while an exception is pending");
      const pending = new ArrayBuffer(8);
      const pendingBytes = new Uint8Array(pending);
      try {
        nativeModule.detach_array_buffer_with_pending_exception(pending);
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.message);
      }
      console.log("byteLength =", pending.byteLength, "detached =", pending.detached);
      console.log("Uint8Array: length =", pendingBytes.length);
      console.log(nativeModule.describe_array_buffer(pending));
    },

    // Bun only: V8 aborts when an addon detaches a buffer that is not detachable, and it has no pinned buffers.
    test_v8_arraybuffer_detach_undetachable() {
      console.log("====== WebAssembly.Memory buffer");
      const memory = new WebAssembly.Memory({ initial: 1 });
      const memoryBuffer = memory.buffer;
      new Uint8Array(memoryBuffer)[0] = 42;
      console.log(nativeModule.detach_array_buffer(memoryBuffer));
      console.log("byteLength =", memoryBuffer.byteLength, "detached =", memoryBuffer.detached);
      console.log("still the memory's buffer =", memory.buffer === memoryBuffer);
      console.log(nativeModule.describe_array_buffer(memoryBuffer));

      console.log("====== SharedArrayBuffer");
      const shared = new SharedArrayBuffer(8);
      const sharedBytes = new Uint8Array(shared);
      sharedBytes.set([1, 2, 3, 4, 5, 6, 7, 8]);
      console.log(nativeModule.detach_array_buffer(shared));
      console.log("byteLength =", shared.byteLength, "bytes =", sharedBytes.join(","));

      // A store from GetBackingStore() pins its buffer, so the addon's own store keeps Detach() from detaching.
      console.log("====== ArrayBuffer whose store the addon holds while it calls Detach()");
      const held = new ArrayBuffer(8);
      new Uint8Array(held).set([1, 2, 3, 4, 5, 6, 7, 8]);
      console.log(nativeModule.read_store_after_detach(held));
      console.log("byteLength =", held.byteLength, "detached =", held.detached);
      console.log("====== the same ArrayBuffer once the addon dropped the store");
      console.log(nativeModule.detach_array_buffer(held));
      console.log("byteLength =", held.byteLength, "detached =", held.detached);

      // Bun pins the input of a threadpool zlib job until the job is done, because the pool thread reads it.
      const buffer = new ArrayBuffer(8);
      const bytes = new Uint8Array(buffer);
      bytes.set([1, 2, 3, 4, 5, 6, 7, 8]);
      require("node:zlib").deflate(bytes, error => {
        if (error) throw error;
        console.log("====== the same ArrayBuffer after the job");
        console.log(nativeModule.detach_array_buffer(buffer));
        console.log("byteLength =", buffer.byteLength, "detached =", buffer.detached);
      });
      console.log("====== ArrayBuffer that a threadpool job is reading");
      console.log(nativeModule.detach_array_buffer(buffer));
      console.log("byteLength =", buffer.byteLength, "detached =", buffer.detached);
      console.log("bytes =", bytes.join(","));
    },

    // Each part runs in its own function, so that no frame refers to its buffers when a later collection frees them.
    test_v8_array_buffer_from_backing_store() {
      console.log("====== the addon drops its std::shared_ptr, JS holds 1 of 65 buffers");
      (() => {
        const buffer = nativeModule.wrapped_buffers_create(0, 65);
        nativeModule.wrapped_memory_collect_garbage();
        console.log("deleters of the 64 buffers that nothing refers to:", describeDeleters(0, 64));
        console.log("deleter calls for the buffer that JS holds =", deleterCalls(64));
        const view = new Uint8Array(buffer);
        view[3] = 77;
        console.log("the addon reads what JS wrote =", nativeModule.wrapped_memory_get(64, 3));
        nativeModule.wrapped_memory_set(64, 5, 200);
        console.log("JS reads what the addon wrote =", view[5]);
        console.log(
          "GetBackingStore() has the addon's memory =",
          nativeModule.wrapped_buffer_store_has_memory(buffer, 64),
        );
        console.log(describeBuffer(buffer));
        nativeModule.detach_array_buffer(buffer);
        console.log("deleter calls after Detach() =", deleterCalls(64));
        console.log(describeBuffer(buffer), "view length =", view.length);
        nativeModule.detach_array_buffer(buffer);
        console.log("deleter calls after a second Detach() =", deleterCalls(64));
      })();
      nativeModule.wrapped_memory_collect_garbage();
      console.log("deleters after JS dropped the detached buffer and a collection ran:", describeDeleters(0, 65));

      console.log("====== the addon keeps its std::shared_ptr past Detach()");
      (() => {
        const buffer = nativeModule.wrapped_buffer_create_keeping_store(65);
        new Uint8Array(buffer)[0] = 42;
        nativeModule.detach_array_buffer(buffer);
        nativeModule.wrapped_memory_collect_garbage();
        console.log(describeBuffer(buffer));
        console.log("deleter calls after Detach() and a collection =", deleterCalls(65));
        console.log("the store still has the addon's memory =", nativeModule.wrapped_kept_store_has_memory(65));
        console.log("the addon reads what JS wrote =", nativeModule.wrapped_memory_get(65, 0));
        nativeModule.wrapped_kept_store_release();
        console.log("deleter calls after the addon released the store =", deleterCalls(65));
      })();

      console.log("====== two ArrayBuffers from one store");
      (() => {
        const [first, second] = nativeModule.wrapped_buffer_pair(66);
        new Uint8Array(first)[0] = 11;
        console.log("two objects =", first !== second);
        console.log("the second reads what JS wrote to the first =", new Uint8Array(second)[0]);
        nativeModule.detach_array_buffer(first);
        console.log("deleter calls after Detach() of the first =", deleterCalls(66));
        console.log("second:", describeBuffer(second), "first byte =", new Uint8Array(second)[0]);
        nativeModule.detach_array_buffer(second);
        console.log("deleter calls after Detach() of the second =", deleterCalls(66));
      })();

      console.log("====== JS keeps a view and not the buffer");
      (() => {
        const view = (() => new Uint8Array(nativeModule.wrapped_buffers_create(67, 1)))();
        nativeModule.wrapped_memory_collect_garbage();
        console.log("deleter calls while JS holds the view =", deleterCalls(67));
        nativeModule.wrapped_memory_set(67, 2, 123);
        console.log("the view reads what the addon wrote =", view[2]);
        nativeModule.detach_array_buffer(view.buffer);
        console.log("deleter calls after Detach() of the view's buffer =", deleterCalls(67));
        console.log("view length =", view.length);
      })();

      console.log("====== a store over zero bytes of the addon's memory");
      (() => {
        const buffer = nativeModule.wrapped_buffers_create(68, 1, 0);
        nativeModule.wrapped_memory_collect_garbage();
        console.log(describeBuffer(buffer), "view length =", new Uint8Array(buffer).length);
        console.log("deleter calls while JS holds the buffer =", deleterCalls(68));
        nativeModule.detach_array_buffer(buffer);
        console.log(describeBuffer(buffer));
        console.log("deleter calls after Detach() =", deleterCalls(68));
      })();

      console.log("====== a store over no memory");
      (() => {
        const buffer = nativeModule.wrapped_buffer_create_without_memory(69);
        console.log(describeBuffer(buffer), "view length =", new Uint8Array(buffer).length);
        nativeModule.detach_array_buffer(buffer);
        console.log(describeBuffer(buffer));
      })();

      console.log("====== once nothing refers to a buffer and a collection ran");
      nativeModule.wrapped_memory_collect_garbage();
      console.log("deleters of the 69 stores with memory:", describeDeleters(0, 69));
      console.log("deleter calls for the store over no memory =", deleterCalls(69));
      console.log(
        "deleter calls without the store's data and length =",
        nativeModule.wrapped_memory_unexpected_deleter_calls(),
      );
    },

    test_v8_array_buffer_from_backing_store_lent_to_handler() {
      lendToHandlers([
        [
          "a handler that only reads the buffer",
          (buffer, view, done) => {
            console.log("the handler reads what the addon wrote =", view[0]);
            setImmediate(done);
          },
        ],
      ]);
    },

    // Bun only: Bun pins the input of a threadpool job until the job is done, and Detach() leaves a pinned buffer
    // attached. The addon then uses its memory for something else, and JS still reads and writes it. V8 has no pins
    // and detaches the buffer.
    test_v8_array_buffer_from_backing_store_lent_to_job() {
      const fs = require("node:fs");
      const zlib = require("node:zlib");
      const deflate = (view, done) =>
        zlib.deflate(view, error => {
          if (error) throw error;
          done();
        });
      const file = path.join(require("node:os").tmpdir(), `v8-lent-to-fs-write-${process.pid}.bin`);
      lendToHandlers(
        [
          ["a handler that gives the buffer to zlib.deflate()", (buffer, view, done) => deflate(view, done)],
          [
            "a handler that adds a property to the buffer and gives it to zlib.deflate()",
            (buffer, view, done) => {
              buffer.addedByTheHandler = true;
              deflate(view, done);
            },
          ],
          [
            "a handler that gives the buffer to fs.write()",
            (buffer, view, done) => {
              const fd = fs.openSync(file, "w");
              fs.write(fd, view, 0, view.length, 0, error => {
                fs.closeSync(fd);
                fs.unlinkSync(file);
                if (error) throw error;
                done();
              });
            },
          ],
        ],
        (lent, lentView, slot) => {
          nativeModule.detach_array_buffer(lent);
          console.log("after Detach() once the job is done:", describeBuffer(lent), "view length =", lentView.length);
          console.log("deleter calls after that Detach() =", deleterCalls(slot));
        },
        (lentView, slot) => {
          console.log("JS reads what the addon wrote to its memory after Detach() =", lentView[1]);
          lentView[0] = 153;
          console.log("the addon reads what JS wrote through the view =", nativeModule.wrapped_memory_get(slot, 0));
        },
      );
    },

    // The buffers die in the Worker, so their stores are destroyed on a thread that did not make them.
    test_v8_array_buffer_from_backing_store_transferred_to_worker() {
      const { Worker } = require("node:worker_threads");
      const [firstSlot, count] = [70, 4];
      const worker = new Worker(
        `const { parentPort } = require("node:worker_threads");
         parentPort.on("message", buffers => {
           globalThis.kept = buffers;
           parentPort.postMessage(buffers.map(buffer => buffer.byteLength + ":" + new Uint8Array(buffer)[0]).join(", "));
         });`,
        { eval: true },
      );
      worker.once("error", error => {
        throw error;
      });
      worker.once("message", seenByWorker => {
        console.log("byteLength and first byte of each buffer in the worker =", seenByWorker);
        console.log("deleters while the worker holds the buffers:", describeDeleters(firstSlot, count));
        worker.terminate();
      });
      worker.once("exit", () => {
        console.log("deleters after the worker exited:", describeDeleters(firstSlot, count));
        const onThisThread = nativeModule.wrapped_memory_deleters_on_this_thread().slice(firstSlot, firstSlot + count);
        console.log("deleters that ran on the thread that made the stores:", onThisThread.filter(Boolean).length);
        console.log(
          "deleter calls without the store's data and length =",
          nativeModule.wrapped_memory_unexpected_deleter_calls(),
        );
      });
      (() => {
        const buffers = [];
        for (let i = 0; i < count; i++) {
          buffers.push(nativeModule.wrapped_buffers_create(firstSlot + i, 1));
          nativeModule.wrapped_memory_set(firstSlot + i, 0, 100 + i);
        }
        worker.postMessage(buffers, buffers);
        console.log("detached by the transfer =", buffers.map(buffer => buffer.detached).join(", "));
      })();
    },

    test_v8_backing_store_byte_length() {
      console.log("====== stores from NewBackingStore()");
      console.log(nativeModule.describe_new_backing_store_byte_lengths());

      // The addon holds each of these stores while JS changes the buffer.
      const showKept = (description, buffer) => {
        console.log(`====== ${description}`);
        console.log(nativeModule.describe_kept_backing_store(buffer));
      };
      const fixed = new ArrayBuffer(8);
      nativeModule.keep_backing_store(fixed);
      showKept("the store of an ArrayBuffer(8)", fixed);

      const resizable = new ArrayBuffer(4, { maxByteLength: 16 });
      nativeModule.keep_backing_store(resizable);
      showKept("the store of a resizable ArrayBuffer, 4 of 16 bytes", resizable);
      resizable.resize(12);
      showKept("the same store after resize(12)", resizable);
      resizable.resize(2);
      showKept("the same store after resize(2)", resizable);

      const detached = new ArrayBuffer(8);
      detached.transfer();
      nativeModule.keep_backing_store(detached);
      showKept("the store of a detached ArrayBuffer", detached);
      nativeModule.release_kept_backing_store();
    },

    test_v8_shared_array_buffer_get_backing_store() {
      const fill = buffer => {
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
        return buffer;
      };
      // The native side writes 0xcc to the last byte through the store's Data(), so this shows that it is not a copy.
      const show = (description, buffer) => {
        console.log(`====== ${description}`);
        console.log(nativeModule.describe_shared_array_buffer_store(buffer));
        if (buffer.byteLength > 0) console.log("last byte seen from JS =", new Uint8Array(buffer).at(-1));
      };
      show("SharedArrayBuffer(8)", fill(new SharedArrayBuffer(8)));
      show("SharedArrayBuffer(0)", new SharedArrayBuffer(0));
      const growable = fill(new SharedArrayBuffer(4, { maxByteLength: 16 }));
      show("growable SharedArrayBuffer, 4 of 16 bytes", growable);
      nativeModule.keep_backing_store(growable);
      growable.grow(8);
      show("the same buffer grown to 8 bytes", growable);
      console.log("====== the store that the addon took before grow(8)");
      console.log(nativeModule.describe_kept_backing_store(growable));
      nativeModule.release_kept_backing_store();
      show("shared WebAssembly.Memory buffer", new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer);
    },

    // Bun only. A store from GetBackingStore() reads JSC's memory through the buffer, so it pins the buffer, and a
    // transfer of a pinned buffer is a copy. V8's store has the memory itself, and every transfer detaches the buffer.
    test_v8_backing_store_held_across_transfers() {
      const { MessageChannel } = require("node:worker_threads");
      const transfers = [
        ["transfer()", async buffer => buffer.transfer()],
        ["structuredClone() with a transfer list", async buffer => structuredClone(buffer, { transfer: [buffer] })],
        [
          "postMessage() with a transfer list",
          buffer =>
            new Promise((resolve, reject) => {
              const { port1, port2 } = new MessageChannel();
              port2.once("messageerror", reject);
              port2.once("message", received => {
                port2.close();
                resolve(received);
              });
              port1.postMessage(buffer, [buffer]);
            }),
        ],
      ];
      const describeGiven = given =>
        console.log("what the transfer gave:", describeBuffer(given), "bytes =", new Uint8Array(given).join(","));
      // One transfer after the other, so that the lines come in one order.
      (async () => {
        for (const [how, transfer] of transfers) {
          console.log(`====== ${how}`);
          const buffer = new ArrayBuffer(8);
          new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8]);
          nativeModule.keep_backing_store(buffer);
          const copy = await transfer(buffer);
          console.log("while the addon holds the store:", describeBuffer(buffer));
          describeGiven(copy);
          new Uint8Array(copy)[0] = 99;
          console.log("the buffer's first byte after a write to that copy =", new Uint8Array(buffer)[0]);
          console.log(nativeModule.describe_kept_backing_store(buffer));
          nativeModule.release_kept_backing_store();
          const moved = await transfer(buffer);
          console.log("after the addon dropped the store:", describeBuffer(buffer));
          describeGiven(moved);
        }

        // JSC copies a pinned buffer into a fixed-length one, which cannot stand in for a resizable buffer.
        console.log("====== a resizable buffer");
        const attempt = (description, run) => {
          try {
            run();
            console.log(`${description}: did not throw`);
          } catch (e) {
            console.log(`${description}: threw ${e.constructor.name}`);
          }
        };
        const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
        nativeModule.keep_backing_store(resizable);
        attempt("transfer()", () => resizable.transfer());
        attempt("structuredClone() of a length-tracking view with the buffer in the transfer list", () =>
          structuredClone(new Uint8Array(resizable), { transfer: [resizable] }),
        );
        console.log("while the addon holds the store:", describeBuffer(resizable));
        nativeModule.release_kept_backing_store();
        const moved = resizable.transfer();
        console.log("after the addon dropped the store:", describeBuffer(resizable));
        console.log("what the transfer gave:", describeBuffer(moved), "resizable =", moved.resizable);
      })();
    },

    // Bun only. The pin and the reference that a store has on its buffer are released by the JS thread that took the
    // store, in its next turn, when another thread drops the store: the two counts of a buffer are not atomic. V8 has
    // no pin, and there the first transfer() detaches the buffer.
    test_v8_backing_store_dropped_on_another_thread() {
      const buffer = new ArrayBuffer(8);
      nativeModule.drop_backing_store_on_another_thread(buffer);
      buffer.transfer();
      console.log("transfer() right after another thread dropped the store:", describeBuffer(buffer));
      // Of the two stores of this buffer, the addon keeps one.
      const kept = new ArrayBuffer(8);
      nativeModule.keep_backing_store(kept);
      nativeModule.drop_backing_store_on_another_thread(kept);
      setImmediate(() => {
        buffer.transfer();
        console.log("transfer() one turn of the event loop later:", describeBuffer(buffer));
        kept.transfer();
        console.log("transfer() of a buffer with a second store that the addon holds:", describeBuffer(kept));
        nativeModule.release_kept_backing_store();
        kept.transfer();
        console.log("transfer() once the addon dropped that store too:", describeBuffer(kept));
      });
    },

    // The Worker ends in the turn in which another thread dropped the store, so it never runs what that thread posted
    // to it. The buffer is over the addon's memory: its deleter runs once nothing holds the buffer.
    test_v8_backing_store_dropped_on_another_thread_before_worker_exit() {
      runInWorker(
        `const buffer = nativeModule.wrapped_buffers_create(0, 1);
         nativeModule.drop_backing_store_on_another_thread(buffer);
         process.exit(0);`,
        () => console.log("deleter calls after the worker exited =", deleterCalls(0)),
      );
    },

    // The addon still holds the store when the Worker that took it is gone.
    test_v8_backing_store_dropped_after_worker_exit() {
      runInWorker(`nativeModule.keep_backing_store(nativeModule.wrapped_buffers_create(0, 1));`, () => {
        console.log("deleter calls while the addon holds the store =", deleterCalls(0));
        nativeModule.release_kept_backing_store();
        console.log("deleter calls after this thread dropped the store =", deleterCalls(0));
      });
    },

    // The teardown of the Worker runs the deleter of the first buffer, which lets another thread drop the store.
    test_v8_backing_store_dropped_during_worker_teardown() {
      runInWorker(
        `globalThis.livesAsLongAsThisThread = nativeModule.create_buffer_whose_deleter_drops_kept_store();
         nativeModule.keep_backing_store(nativeModule.wrapped_buffers_create(0, 1));`,
        () => console.log("deleter calls after the worker exited =", deleterCalls(0)),
      );
    },

    // Bun only: prints what expectRssDeltaBelow() reads. Job threads own stores of one SharedArrayBuffer and drop them
    // while this thread takes stores of it too. The buffer's reference count is not atomic: a store that a job thread
    // deleted would corrupt it, and the buffer would be freed too early or never.
    test_v8_shared_backing_store_dropped_by_job_threads_leak() {
      const megabyte = 1024 * 1024;
      const turn = () => new Promise(resolve => setImmediate(resolve));
      const collect = async () => {
        for (let i = 0; i < 3; i++) {
          Bun.gc(true);
          await turn();
        }
      };
      const useOneBuffer = async () => {
        const buffer = new SharedArrayBuffer(32 * megabyte);
        new Uint8Array(buffer).fill(1);
        for (let round = 0; round < 10; round++) {
          nativeModule.start_shared_store_jobs(buffer, 64);
          do {
            nativeModule.take_shared_stores(buffer, 50);
            await turn();
          } while (nativeModule.count_shared_store_jobs_running() > 0);
          await turn();
        }
      };
      (async () => {
        await useOneBuffer();
        await collect();
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 8; i++) {
          await useOneBuffer();
          await collect();
        }
        // The memory of a buffer that was freed comes back a few turns later.
        const deadline = Date.now() + 10_000;
        while (process.memoryUsage.rss() - before > 24 * megabyte && Date.now() < deadline) await collect();
        console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / megabyte }));
      })();
    },

    test_v8_return_value_from_inner_scope() {
      // The native functions invoke this after their inner handle scope closed,
      // while the callback is still on the stack, so the collection runs in the
      // window where only the preserved return value keeps the cell alive.
      // No-op under Node so the output matches.
      const maybeGc = () => {
        if (process.isBun) {
          Bun.gc(true);
        }
      };
      console.log("string =", nativeModule.return_string_from_inner_scope(1, maybeGc));
      console.log("number =", nativeModule.return_heap_number_from_inner_scope(1, maybeGc));
      console.log("element =", nativeModule.return_array_element_from_iterate(["one", "two", "three"], maybeGc));
      console.log("accessor =", nativeModule.return_accessor_value_from_inner_scope());
    },

    test_v8_function_call() {
      function target(a, b, c) {
        if (arguments.length === 0) return this && this.tag;
        return a + 1;
      }
      const err = nativeModule.test_v8_function_call(target);
      if (err) throw new Error(err);
    },

    test_v8_map() {
      const map = new Map();
      const ret = nativeModule.test_v8_map(map);
      if (typeof ret === "string") throw new Error(ret);
      console.log("size =", map.size);
      console.log("has a =", map.has("a"));
      console.log("has b =", map.has("b"));
      console.log("get b =", map.get("b"));
    },

    test_v8_exception() {
      try {
        nativeModule.test_v8_exception();
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.constructor.name, e.message);
      }
    },

    test_v8_exception_empty_message() {
      for (const e of nativeModule.test_v8_exception_empty_message()) {
        console.log(e.constructor.name, "message =", JSON.stringify(e.message), "own =", Object.hasOwn(e, "message"));
      }
    },

    test_v8_throw_error_empty_message() {
      try {
        nativeModule.test_v8_throw_error_empty_message();
        console.log("did not throw");
      } catch (e) {
        const own = Object.hasOwn(e, "message");
        console.log("caught", e.constructor.name, "message =", JSON.stringify(e.message), "own =", own);
      }
    },

    test_v8_new_values_with_pending_exception() {
      try {
        nativeModule.test_v8_new_values_with_pending_exception();
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.message);
      }
    },

    print_native_function() {
      nativeModule.print_values_from_js(nativeModule.create_function_with_data());
    },

    call_function_with_weird_this_values() {
      for (const thisValue of [null, undefined, 5, "abc"]) {
        const ret = nativeModule.return_this.call(thisValue);
        console.log("typeof =", typeof ret);
        if (ret == globalThis) {
          console.log("returned globalThis");
        } else if (ret instanceof String) {
          console.log("returned boxed String:", ret.toString());
        } else {
          console.log("returned", ret);
        }
        console.log("constructor is", ret.constructor.name);
      }
    },

    call_function_bare_through_closure() {
      const { return_this } = nativeModule;
      // return_this is captured by keep, so the bare call below is resolved through the closure's
      // scope object, which JSC leaves in the call's this slot. The callback must still see the
      // sloppy-mode receiver (globalThis), never that scope object.
      function keep() {
        return return_this;
      }
      console.log("bare call returned globalThis:", return_this() === globalThis);
      keep();
    },

    native_accessor_holder_on_property_access() {
      const obj = nativeModule.create_object_with_holder_accessor();
      console.log("getter holder is the object:", obj.holder === obj);
      obj.holder = 1;
      console.log("setter holder is the object:", nativeModule.global_get() === obj);
    },

    // Bun only: V8 itself installs a native data property as a data property, so Bun is the one
    // runtime where its getter and setter exist as functions that can be called with any receiver.
    native_accessor_holder_for_weird_receivers() {
      const obj = nativeModule.create_object_with_holder_accessor();
      const { get, set } = Object.getOwnPropertyDescriptor(obj, "holder");
      // get and set are captured by keep, so the bare calls below are resolved through the
      // closure's scope object, which JSC leaves in the call's this slot.
      function keep() {
        return [get, set];
      }
      const describe = value => {
        if (value === globalThis) return "globalThis";
        if (value === obj) return "the object";
        if (value instanceof Number) return "a Number object";
        return typeof value;
      };
      const holderSeenBySetter = receiver => {
        nativeModule.global_set(undefined);
        set.call(receiver, 1);
        return nativeModule.global_get();
      };
      console.log("bare getter():", describe(get()));
      console.log("getter.call(undefined):", describe(get.call(undefined)));
      console.log("getter.call(null):", describe(get.call(null)));
      console.log("getter.call(5):", describe(get.call(5)));
      console.log("getter.call(obj):", describe(get.call(obj)));
      nativeModule.global_set(undefined);
      set(1);
      console.log("bare setter():", describe(nativeModule.global_get()));
      console.log("setter.call(undefined):", describe(holderSeenBySetter(undefined)));
      console.log("setter.call(null):", describe(holderSeenBySetter(null)));
      console.log("setter.call(5):", describe(holderSeenBySetter(5)));
      console.log("setter.call(obj):", describe(holderSeenBySetter(obj)));
      keep();
    },

    test_uv_queue_work_on_current_event_loop() {
      const rc = nativeModule.queue_work_and_call((...args) => console.log("after_work_cb", ...args));
      console.log("uv_queue_work", rc);
    },

    test_v8_object_get_set_exceptions() {
      for (const key of [0, "key"]) {
        for (const access of ["get", "set"]) {
          const name = `perform_object_${access}_by_${typeof key == "number" ? "index" : "key"}`;
          const nativeFunction = nativeModule[name];
          if (typeof nativeFunction !== "function") throw new Error(name);

          const normal = { [key]: 5 };
          const accessor = {};
          Object.defineProperty(accessor, key, {
            [access](...args) {
              throw new Error("exception from accessor");
            },
          });
          const proxy = new Proxy(
            {},
            {
              [access](...args) {
                throw new Error("exception from proxy");
              },
            },
          );
          const readonly = {};
          Object.defineProperty(readonly, key, { configurable: true, writable: false, enumerable: true, value: "bar" });

          for (const [object, description] of [
            [normal, "plain object"],
            [accessor, "object with accessor that throws"],
            [proxy, "proxy with handler that throws"],
            [readonly, "plain object with readonly property"],
          ]) {
            console.log(`======\n${access} ${key} on ${description}`);
            try {
              nativeFunction(object, key, "foo");
              console.log("did not throw");
              if (object === normal || object === readonly) console.log("now value is", object[key]);
            } catch (e) {
              console.log(`threw: ${e.message}`);
            }
          }
        }
      }
    },

    test_v8_value_number_value() {
      logNumberConversions(nativeModule.perform_number_value);
    },

    test_v8_value_int32_value() {
      logNumberConversions(nativeModule.perform_int32_value);
    },

    test_v8_value_number_value_with_pending_exception() {
      logNumberConversionsWithPendingException(nativeModule.perform_number_value_with_pending_exception);
    },

    test_v8_value_int32_value_with_pending_exception() {
      logNumberConversionsWithPendingException(nativeModule.perform_int32_value_with_pending_exception);
    },

    test_v8_value_boolean_value() {
      const cases = [
        ["0", 0],
        ["-0", -0],
        ["NaN", NaN],
        ["''", ""],
        ["'0'", "0"],
        ["'false'", "false"],
        ["[]", []],
        ["{}", {}],
        ["null", null],
        ["undefined", undefined],
        ["0n", 0n],
        ["1n", 1n],
        ["Symbol", Symbol("symbol")],
      ];
      for (const [description, value] of cases) {
        console.log(`====== ${description}`);
        try {
          nativeModule.perform_boolean_value(value);
        } catch (e) {
          console.log("threw", e.constructor.name);
        }
      }
    },

    test_v8_function_template_c_function() {
      const add = nativeModule.create_function_with_c_function();
      console.log("add(40, 2) =", add(40, 2));
    },

    ...require("./object-get-own-property-names")(nativeModule),
    ...require("./object-clone")(nativeModule),

    // Bun only: Clone() ends the process with a panic for each of these. V8 copies all but the Map.
    test_v8_object_clone_refused(which) {
      const templateInstance = () => nativeModule.create_external_and_template_instance()[1];
      const withIndexKey = templateInstance();
      withIndexKey[0] = "index key";
      const usedAsPrototype = templateInstance();
      Object.create(usedAsPrototype);
      const with200Properties = templateInstance();
      for (let i = 0; i < 200; i++) with200Properties["p" + i] = i;
      class WithPrivateMethod {
        #method() {}
      }
      const withPrivateMethod = new WithPrivateMethod();
      withPrivateMethod[0] = "index key";
      const refused = {
        "a Map": new Map(),
        "a template instance with an index key": withIndexKey,
        "a template instance that was used as a prototype": usedAsPrototype,
        "a template instance with 200 properties added in a loop": with200Properties,
        "an object with a private method and an index key": withPrivateMethod,
      };
      if (!Object.hasOwn(refused, which)) throw new Error(`unknown object: ${which}`);
      nativeModule.perform_object_clone(refused[which]);
      console.log("Clone() returned");
    },
  };
};

// Calls perform, which throws and then prints one conversion, on numbers: V8 converts a number without running JS.
function logNumberConversionsWithPendingException(perform) {
  const convert = (description, number) => {
    console.log(`====== ${description}`);
    try {
      perform(number);
      console.log("did not throw");
    } catch (e) {
      console.log("caught", e.message);
    }
  };
  convert("1.5", 1.5);
  // JSC holds these two as int32 and 1.5 as a double. Out of one array literal with 1.5, they would be doubles too.
  convert("7", 7);
  convert("-1", -1);
}

// Calls perform, which prints one conversion to a number, on every value that the conversion tests compare.
function logNumberConversions(perform) {
  const valueOfError = new RangeError("valueOf threw");
  const cases = [
    ["'3000'", "3000"],
    ["' 42 '", " 42 "],
    ["'0x10'", "0x10"],
    ["'1e3'", "1e3"],
    ["'12px'", "12px"],
    ["'abc'", "abc"],
    ["''", ""],
    ["'-1'", "-1"],
    ["'-1.5'", "-1.5"],
    ["'-4294967297'", "-4294967297"],
    ["-1", -1],
    ["4294967296", 4294967296],
    ["4294967297.5", 4294967297.5],
    ["1e21", 1e21],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["-0", -0],
    ["true", true],
    ["null", null],
    ["undefined", undefined],
    ["[]", []],
    ["[7]", [7]],
    ["object with valueOf returning 77.9", { valueOf: () => 77.9 }],
    ["object with valueOf returning -1", { valueOf: () => -1 }],
    ["Date", new Date(1234567890123)],
    ["Symbol", Symbol("symbol")],
    ["10n", 10n],
    [
      "object with throwing valueOf",
      {
        valueOf() {
          throw valueOfError;
        },
      },
    ],
  ];
  for (const [description, value] of cases) {
    console.log(`====== ${description}`);
    try {
      perform(value);
    } catch (e) {
      // V8 and JSC word the TypeError differently, so print only its class.
      console.log("threw", e === valueOfError ? "the valueOf error" : e.constructor.name);
    }
  }
}

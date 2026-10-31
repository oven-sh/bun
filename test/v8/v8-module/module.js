const path = require("node:path");

module.exports = debugMode => {
  const nativeModule = require(`./build/${debugMode ? "Debug" : "Release"}/v8tests`);
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

    // uWebSockets.js holds a value in a v8::Global for every request and every WebSocket, so a
    // Global that is reset has to let go of its value.
    test_v8_global_reset_releases_value() {
      const count = 1000;
      // Leaves room for a few objects that something other than a Global keeps alive.
      const enough = count - 10;
      let collectGarbage;
      if (process.isBun) {
        collectGarbage = () => Bun.gc(true);
      } else {
        // Node only has gc() with --expose-gc, which can still be turned on here.
        require("node:v8").setFlagsFromString("--expose-gc");
        collectGarbage = require("node:vm").runInNewContext("gc");
      }
      // Both functions have returned before the first collection, so that only a Global could
      // still refer to the objects that they created.
      function resetInTheSameCall() {
        const refs = [];
        for (let i = 0; i < count; i++) {
          const object = { i };
          refs.push(new WeakRef(object));
          if (nativeModule.global_hold_and_reset(object) !== object) {
            throw new Error("global_hold_and_reset did not return the value of its Global");
          }
        }
        return refs;
      }
      function heldUntilALaterCall() {
        const refs = [];
        for (let i = 0; i < count; i++) {
          const object = { i };
          refs.push(new WeakRef(object));
          nativeModule.global_hold(object);
        }
        return refs;
      }
      const countCollected = refs => refs.filter(ref => ref.deref() === undefined).length;
      // A WeakRef keeps its target alive until the job that created or read it ends, so each
      // collection runs in a later turn of the event loop than the one before.
      async function collect(refs) {
        let collected = 0;
        for (let turn = 0; turn < 10 && collected < enough; turn++) {
          await new Promise(resolve => setImmediate(resolve));
          collectGarbage();
          collected = countCollected(refs);
        }
        return collected;
      }
      // Writes the counts to stderr, and to stdout only when they are too low, because the test
      // compares what Node and Bun write to stdout.
      function report(description, state, number, expected) {
        const counts = `${number} of ${count} ${state}`;
        console.error(`${description}: ${counts}`);
        console.log(`${description}:`, number >= expected ? state : `only ${counts}`);
      }
      (async () => {
        const sameCall = resetInTheSameCall();
        const laterCall = heldUntilALaterCall();
        report("values of Globals reset in the call that created them", "collected", await collect(sameCall), enough);
        // The collections above ran while these Globals held their values.
        report("values of Globals not reset yet", "alive", count - countCollected(laterCall), count);
        nativeModule.global_reset_held();
        report("values of Globals reset in a later call", "collected", await collect(laterCall), enough);
      })();
    },

    // A Local or a return value that was read from a v8::Global stays the same when the Global is
    // reset, even if another Global takes over its handle.
    test_v8_global_reset_keeps_locals_and_return_values() {
      let othersHeldTheirValues = true;
      // Calls a native function that resets the stored Global and then creates a Global for each
      // of its arguments. One of them could take over the handle that the stored Global gave back.
      const callWithOthers = name => {
        const others = Array.from({ length: 16 }, (_, i) => ({ name: `other ${i}` }));
        const result = nativeModule[name](...others);
        const held = nativeModule.global_held();
        nativeModule.global_reset_held();
        if (held.length !== others.length || !held.every((value, i) => value === others[i])) {
          othersHeldTheirValues = false;
        }
        return result;
      };

      // Only the Global refers to the object.
      nativeModule.global_store({ name: "first" });
      console.log("returned local =", callWithOthers("global_local_outlives_reset").name);

      const makeValues = [
        () => ({ name: "second" }),
        () => "a string",
        () => 12.5,
        () => 7,
        () => undefined,
        () => null,
        () => true,
        () => false,
      ];
      for (const name of ["global_return_local_then_reset", "global_return_global_then_reset"]) {
        // Each call gets a new object, so that only the Global refers to it.
        const returned = makeValues.map(makeValue => {
          nativeModule.global_store(makeValue());
          return String(JSON.stringify(callWithOthers(name)));
        });
        console.log(`${name} returned`, returned.join(", "));
      }

      nativeModule.global_store({ name: "third" });
      const nested = nativeModule.global_local_outlives_nested_reset(() => {
        // Each call resets the Global: it disposes the handle of the previous value and creates
        // one for the new value.
        nativeModule.global_store({ name: "fourth" });
        nativeModule.global_store({ name: "fifth" });
      });
      console.log("returned after nested calls reset the Global =", nested.name);
      console.log("the Global then held", JSON.stringify(nativeModule.global_return_global_then_reset()));
      console.log("the other Globals held their values =", othersHeldTheirValues);
    },

    test_v8_global_reset_primitives() {
      // A round can get the handles that the Globals of an earlier round gave back.
      for (let round = 0; round < 5; round++) {
        nativeModule.global_primitives_round(round);
      }
      nativeModule.global_primitives_round(-1);
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
      // Again as a constructor, which returns the array too. Bun calls a constructor callback under an exception
      // scope, and there JSC's exception check validation (on in ASAN CI) aborts if the shim skips a check.
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
      // The native side writes 0xee to the last byte through Data(). Reading it back here shows
      // that Data() is the buffer's own memory and not a copy.
      const show = (description, buffer, describe) => {
        console.log(`====== ${description}`);
        console.log(describe(buffer));
        if (buffer.byteLength > 0) console.log("last byte seen from JS =", new Uint8Array(buffer).at(-1));
      };
      const showArrayBuffer = (description, buffer) => show(description, buffer, nativeModule.describe_array_buffer);
      const showShared = (description, buffer) => show(description, buffer, nativeModule.describe_shared_array_buffer);

      showArrayBuffer("ArrayBuffer(8)", fill(new ArrayBuffer(8)));
      showArrayBuffer("ArrayBuffer(0)", new ArrayBuffer(0));
      const transferred = fill(new ArrayBuffer(8));
      transferred.transfer();
      showArrayBuffer("ArrayBuffer(8) detached by transfer()", transferred);
      const resizable = fill(new ArrayBuffer(4, { maxByteLength: 16 }));
      showArrayBuffer("resizable ArrayBuffer, 4 of 16 bytes", resizable);
      resizable.resize(12);
      showArrayBuffer("resizable ArrayBuffer grown to 12 bytes", resizable);
      resizable.resize(0);
      showArrayBuffer("resizable ArrayBuffer shrunk to 0 bytes", resizable);
      const offsetView = new Uint8Array(fill(new ArrayBuffer(8)), 2, 4);
      showArrayBuffer("the buffer of a Uint8Array over bytes 2..6 of an ArrayBuffer", offsetView.buffer);
      const fromArray = new Uint8Array([5, 6, 7]);
      showArrayBuffer("the buffer of a Uint8Array made from an array", fromArray.buffer);
      console.log("last byte seen through the Uint8Array =", fromArray.at(-1));
      showArrayBuffer("WebAssembly.Memory buffer", new WebAssembly.Memory({ initial: 1 }).buffer);

      showShared("SharedArrayBuffer(8)", fill(new SharedArrayBuffer(8)));
      showShared("SharedArrayBuffer(0)", new SharedArrayBuffer(0));
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

    // Bun only. V8 aborts the process when an addon detaches a buffer that is not detachable, and
    // it has no pinned buffers.
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

      // Bun pins the input of a threadpool zlib job until the job is done, because the pool
      // thread reads it.
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

    // The addon wraps its memory in stores, one slot of memory per store (see main.cpp). Each part runs in a function
    // of its own, so that no frame refers to its buffers when a later collection is expected to free them.
    test_v8_array_buffer_from_backing_store() {
      const deleterCalls = slot => nativeModule.wrapped_memory_deleter_calls()[slot];
      const deleters = (firstSlot, count) => {
        const calls = nativeModule.wrapped_memory_deleter_calls().slice(firstSlot, firstSlot + count);
        const ran = calls.filter(n => n > 0).length;
        return `${ran} of ${count} ran, ${calls.filter(n => n > 1).length} more than once`;
      };
      const describe = buffer => `byteLength = ${buffer.byteLength}, detached = ${buffer.detached}`;

      console.log("====== the addon drops its std::shared_ptr, JS holds 1 of 65 buffers");
      (() => {
        const buffer = nativeModule.wrapped_buffers_create(0, 65);
        nativeModule.wrapped_memory_collect_garbage();
        console.log("deleters of the 64 buffers that nothing refers to:", deleters(0, 64));
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
        console.log(describe(buffer));
        nativeModule.detach_array_buffer(buffer);
        console.log("deleter calls after Detach() =", deleterCalls(64));
        console.log(describe(buffer), "view length =", view.length);
        nativeModule.detach_array_buffer(buffer);
        console.log("deleter calls after a second Detach() =", deleterCalls(64));
      })();
      nativeModule.wrapped_memory_collect_garbage();
      console.log("deleters after JS dropped the detached buffer and a collection ran:", deleters(0, 65));

      console.log("====== the addon keeps its std::shared_ptr past Detach()");
      (() => {
        const buffer = nativeModule.wrapped_buffer_create_keeping_store(65);
        new Uint8Array(buffer)[0] = 42;
        nativeModule.detach_array_buffer(buffer);
        nativeModule.wrapped_memory_collect_garbage();
        console.log(describe(buffer));
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
        console.log("second:", describe(second), "first byte =", new Uint8Array(second)[0]);
        nativeModule.detach_array_buffer(second);
        console.log("deleter calls after Detach() of the second =", deleterCalls(66));
      })();

      console.log("====== the addon keeps the std::shared_ptr from GetBackingStore() past Detach()");
      (() => {
        const buffer = nativeModule.wrapped_buffers_create(67, 1);
        new Uint8Array(buffer)[0] = 43;
        nativeModule.wrapped_buffer_keep_store(buffer);
        nativeModule.detach_array_buffer(buffer);
        nativeModule.wrapped_memory_collect_garbage();
        console.log(describe(buffer));
        console.log("deleter calls after Detach() and a collection =", deleterCalls(67));
        console.log("the store still has the addon's memory =", nativeModule.wrapped_kept_store_has_memory(67));
        console.log("the addon reads what JS wrote =", nativeModule.wrapped_memory_get(67, 0));
        nativeModule.wrapped_kept_store_release();
        console.log("deleter calls after the addon released the store =", deleterCalls(67));
      })();

      console.log("====== a second ArrayBuffer from the store that GetBackingStore() returned");
      (() => {
        const first = nativeModule.wrapped_buffers_create(68, 1);
        nativeModule.wrapped_buffer_keep_store(first);
        const second = nativeModule.wrapped_buffer_create_from_kept_store();
        nativeModule.wrapped_kept_store_release();
        const secondView = new Uint8Array(second);
        new Uint8Array(first)[0] = 12;
        console.log("two objects =", first !== second);
        console.log("the second reads what JS wrote to the first =", secondView[0]);
        nativeModule.detach_array_buffer(first);
        console.log("deleter calls after Detach() of the first =", deleterCalls(68));
        console.log("second:", describe(second), "first byte =", secondView[0]);
        nativeModule.detach_array_buffer(second);
        console.log("deleter calls after Detach() of the second =", deleterCalls(68));
      })();

      console.log("====== JS keeps a view and not the buffer");
      (() => {
        const view = (() => new Uint8Array(nativeModule.wrapped_buffers_create(69, 1)))();
        nativeModule.wrapped_memory_collect_garbage();
        console.log("deleter calls while JS holds the view =", deleterCalls(69));
        nativeModule.wrapped_memory_set(69, 2, 123);
        console.log("the view reads what the addon wrote =", view[2]);
        nativeModule.detach_array_buffer(view.buffer);
        console.log("deleter calls after Detach() of the view's buffer =", deleterCalls(69));
        console.log("view length =", view.length);
      })();

      console.log("====== a store over zero bytes of the addon's memory");
      (() => {
        const buffer = nativeModule.wrapped_buffers_create(70, 1, 0);
        nativeModule.wrapped_memory_collect_garbage();
        console.log(describe(buffer), "view length =", new Uint8Array(buffer).length);
        console.log("deleter calls while JS holds the buffer =", deleterCalls(70));
        nativeModule.detach_array_buffer(buffer);
        console.log(describe(buffer));
        console.log("deleter calls after Detach() =", deleterCalls(70));
      })();

      console.log("====== a store over no memory");
      (() => {
        const buffer = nativeModule.wrapped_buffer_create_without_memory(71);
        console.log(describe(buffer), "view length =", new Uint8Array(buffer).length);
        nativeModule.detach_array_buffer(buffer);
        console.log(describe(buffer));
      })();

      console.log("====== once nothing refers to a buffer and a collection ran");
      nativeModule.wrapped_memory_collect_garbage();
      console.log("deleters of the 71 stores with memory:", deleters(0, 71));
      console.log("deleter calls for the store over no memory =", deleterCalls(71));
      console.log(
        "deleter calls without the store's data and length =",
        nativeModule.wrapped_memory_unexpected_deleter_calls(),
      );
    },

    // Bun only: V8 calls the deleter without checking it.
    test_v8_new_backing_store_null_deleter() {
      nativeModule.wrapped_store_destroy_with_null_deleter(0);
      console.log("the addon destroyed a store that no ArrayBuffer was made from");
      (() => {
        const buffer = nativeModule.wrapped_buffers_create_with_null_deleter(1, 9);
        nativeModule.wrapped_memory_collect_garbage();
        console.log("a collection ran while nothing refers to 8 of 9 buffers");
        const view = new Uint8Array(buffer);
        view[3] = 77;
        console.log("the addon reads what JS wrote =", nativeModule.wrapped_memory_get(9, 3));
        nativeModule.wrapped_memory_set(9, 5, 200);
        console.log("JS reads what the addon wrote =", view[5]);
        nativeModule.detach_array_buffer(buffer);
        console.log(`byteLength = ${buffer.byteLength}, detached = ${buffer.detached}`);
      })();
      nativeModule.wrapped_memory_collect_garbage();
      console.log("a collection ran after JS dropped the detached buffer");
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

    test_v8_value_uint32_value() {
      logNumberConversions(nativeModule.perform_uint32_value);
    },

    test_v8_value_uint32_value_with_pending_exception() {
      for (const number of [3000, -1, 1.5]) {
        console.log(`====== ${number}`);
        try {
          nativeModule.perform_uint32_value_with_pending_exception(number);
          console.log("did not throw");
        } catch (e) {
          console.log("caught", e.message);
        }
      }
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

    test_v8_object_get_own_property_names() {
      // v8::PropertyFilter
      const ALL_PROPERTIES = 0;
      const ONLY_WRITABLE = 1;
      const ONLY_ENUMERABLE = 2;
      const ONLY_CONFIGURABLE = 4;
      const SKIP_STRINGS = 8;
      const SKIP_SYMBOLS = 16;
      const filterBits = { ONLY_WRITABLE, ONLY_ENUMERABLE, ONLY_CONFIGURABLE, SKIP_STRINGS, SKIP_SYMBOLS };
      // v8::KeyConversionMode
      const kConvertToString = 0;
      const kKeepNumbers = 1;
      const kNoNumbers = 2;
      const conversionNames = ["kConvertToString", "kKeepNumbers", "kNoNumbers"];

      class TrapError extends Error {}

      const describeFilter = filter =>
        Object.keys(filterBits)
          .filter(name => filter & filterBits[name])
          .join("|") || "ALL_PROPERTIES";
      const describeKey = key =>
        typeof key === "symbol" ? `symbol(${key.description})` : `${typeof key} ${JSON.stringify(key)}`;

      // Without a filter the one-argument overload is called, without a conversion the default argument is used.
      function getNames(object, filter, conversion) {
        const args = [object];
        if (filter !== undefined) args.push(filter);
        if (conversion !== undefined) args.push(conversion);
        return nativeModule.perform_get_own_property_names(...args);
      }

      function show(description, object, filter, conversion) {
        let line = `${description}, ${filter === undefined ? "one-argument overload" : describeFilter(filter)}`;
        if (conversion !== undefined) line += `, ${conversionNames[conversion]}`;
        let names;
        try {
          names = getNames(object, filter, conversion);
        } catch (e) {
          // only the errors thrown by this test have a message that is the same in every engine
          console.log(`${line}: threw ${e instanceof TrapError ? `TrapError: ${e.message}` : e.constructor.name}`);
          return;
        }
        if (Array.isArray(names)) console.log(`${line}: ${names.length} [${names.map(describeKey).join(", ")}]`);
        else console.log(`${line}: returned ${typeof names}`);
      }

      const symbols = {
        enumerable: Symbol("enumerable"),
        hidden: Symbol("hidden"),
        readOnly: Symbol("readOnly"),
        nonConfigurable: Symbol("nonConfigurable"),
      };
      // A getter that runs shows up as an exception: listing the keys must not read any value.
      const accessor = {
        get() {
          throw new TrapError("a getter ran");
        },
        set() {
          throw new TrapError("a setter ran");
        },
      };
      function createMixedObject() {
        const object = {};
        object.b = 1;
        object[7] = 1;
        object[symbols.enumerable] = 1;
        object.a = 1;
        object[2] = 1;
        const define = (key, descriptor) => Object.defineProperty(object, key, descriptor);
        define("hidden", { value: 1, writable: true, enumerable: false, configurable: true });
        define("readOnly", { value: 1, writable: false, enumerable: true, configurable: true });
        define("nonConfigurable", { value: 1, writable: true, enumerable: true, configurable: false });
        define("frozen", { value: 1, writable: false, enumerable: false, configurable: false });
        define("getter", { get: accessor.get, enumerable: true, configurable: true });
        define("setter", { set: accessor.set, enumerable: true, configurable: true });
        define("hiddenGetter", { get: accessor.get, enumerable: false, configurable: true });
        define("fixedAccessor", { ...accessor, enumerable: true, configurable: false });
        define(symbols.hidden, { value: 1, writable: true, enumerable: false, configurable: true });
        define(symbols.readOnly, { value: 1, writable: false, enumerable: true, configurable: true });
        define(symbols.nonConfigurable, { value: 1, writable: true, enumerable: true, configurable: false });
        define(5, { value: 1, writable: true, enumerable: false, configurable: true });
        define(4, { value: 1, writable: false, enumerable: true, configurable: true });
        define(3, { value: 1, writable: true, enumerable: true, configurable: false });
        define(1, { get: accessor.get, enumerable: true, configurable: true });
        object.z = 1;
        return object;
      }

      console.log("====== every filter on an object with index, string, accessor and symbol keys");
      const mixed = createMixedObject();
      show("mixed", mixed);
      for (let filter = ALL_PROPERTIES; filter <= 31; filter++) show("mixed", mixed, filter);

      console.log("====== key conversion");
      // kNoNumbers tells V8 to expect no index keys. Only a debug build of V8 checks that: the keys stay numbers.
      for (const filter of [ALL_PROPERTIES, ONLY_ENUMERABLE | SKIP_SYMBOLS, SKIP_STRINGS]) {
        for (const conversion of [kConvertToString, kKeepNumbers, kNoNumbers]) show("mixed", mixed, filter, conversion);
      }
      show("string keys only", { b: 1, a: 1 }, ALL_PROPERTIES, kNoNumbers);

      console.log("====== which keys are indices");
      // 4294967294 is the largest array index
      const limits = { name: 1 };
      for (const key of "4294967295 4294967294 2147483648 10 9 0 -1 -0 01 1.5 1e3".split(" ")) limits[key] = 1;
      show("limits", limits);
      for (const conversion of [kConvertToString, kKeepNumbers, kNoNumbers]) {
        show("limits", limits, ALL_PROPERTIES, conversion);
      }

      console.log("====== own keys only");
      const prototype = { inherited: 1, 3: 1, [Symbol("inherited")]: 1 };
      const derived = Object.create(prototype);
      derived.own = 1;
      derived[8] = 1;
      show("object with a prototype", derived);
      show("object with a prototype", derived, ALL_PROPERTIES);
      class WithPrivateField {
        #hidden = 1;
        visible = this.#hidden;
      }
      show("class instance with a private field", new WithPrivateField(), ALL_PROPERTIES);
      show("empty object", {});
      show("empty object", {}, ALL_PROPERTIES);
      show("object without a prototype", Object.assign(Object.create(null), { x: 1, 0: 1 }), ALL_PROPERTIES);

      // Not covered: ONLY_WRITABLE and ONLY_CONFIGURABLE on a frozen or sealed object that has index keys. V8 lists
      // those keys whatever their attributes are, as long as it stores them as fast elements, which JS cannot observe.
      console.log("====== frozen and sealed objects");
      const frozen = Object.freeze({ a: 1, [symbols.enumerable]: 1 });
      const sealed = Object.seal({ a: 1, [symbols.enumerable]: 1 });
      for (const filter of [ALL_PROPERTIES, ONLY_WRITABLE, ONLY_CONFIGURABLE]) {
        show("frozen object", frozen, filter);
        show("sealed object", sealed, filter);
      }
      const frozenArray = Object.freeze(["a", "b"]);
      show("frozen array", frozenArray);
      show("frozen array", frozenArray, ALL_PROPERTIES);

      console.log("====== arrays");
      const attributeFilters = [undefined, ALL_PROPERTIES, ONLY_WRITABLE, ONLY_ENUMERABLE, ONLY_CONFIGURABLE];
      for (const filter of [...attributeFilters, SKIP_STRINGS]) show("array", ["a", "b", "c"], filter);
      const holey = ["a", , "c"];
      holey.extra = 1;
      holey[Symbol("onArray")] = 1;
      for (const filter of [undefined, ALL_PROPERTIES, SKIP_STRINGS]) {
        show("array with a hole and a key", holey, filter);
      }
      const sparse = [];
      sparse[1000000] = 1;
      sparse[3] = 1;
      show("sparse array", sparse);
      const elementAttributes = ["a", "b", "c", "d"];
      Object.defineProperty(elementAttributes, 1, { writable: false });
      Object.defineProperty(elementAttributes, 2, { enumerable: false });
      Object.defineProperty(elementAttributes, 3, { configurable: false });
      for (const filter of attributeFilters) show("array with element attributes", elementAttributes, filter);

      console.log("====== typed arrays");
      const bytes = new Uint8Array(3);
      bytes.extra = 1;
      bytes[Symbol("onTypedArray")] = 1;
      for (const filter of [...attributeFilters, SKIP_STRINGS]) show("Uint8Array", bytes, filter);
      show("Uint8Array", bytes, ALL_PROPERTIES, kConvertToString);
      show("empty Float64Array", new Float64Array(0), ALL_PROPERTIES);

      console.log("====== String objects");
      const string = new String("ab");
      string.extra = 1;
      string[5] = 1;
      string[Symbol("onString")] = 1;
      for (const filter of [...attributeFilters, ONLY_WRITABLE | ONLY_ENUMERABLE | ONLY_CONFIGURABLE, SKIP_STRINGS]) {
        show("String object", string, filter);
      }
      show("String object", string, ALL_PROPERTIES, kConvertToString);
      show("empty String object", new String(""), ALL_PROPERTIES);

      console.log("====== symbols");
      const symbolKeys = [Symbol.iterator, Symbol.for("registered"), Symbol(), Symbol("")];
      const withSymbols = { string: 1 };
      for (const symbol of symbolKeys) withSymbols[symbol] = 1;
      show("symbol keys", withSymbols, SKIP_STRINGS);
      const sameSymbols = getNames(withSymbols, SKIP_STRINGS).every((symbol, i) => symbol === symbolKeys[i]);
      console.log("the same symbols:", sameSymbols);

      console.log("====== the result is a new array every time");
      const plain = { a: 1, b: 2 };
      const first = getNames(plain);
      first.push("pushed");
      first[0] = "replaced";
      const second = getNames(plain);
      console.log("second result:", second.map(describeKey).join(", "));
      console.log("distinct arrays:", first !== second);
      console.log("prototype is Array.prototype:", Object.getPrototypeOf(second) === Array.prototype);
      console.log("Object.keys afterwards:", Object.keys(plain).join(", "));

      console.log("====== many keys");
      const many = {};
      for (let i = 0; i < 600; i++) {
        many[`key${i}`] = i;
        many[599 - i] = i;
      }
      const manyNames = getNames(many);
      console.log("count:", manyNames.length);
      const indicesAscend = manyNames.slice(0, 600).every((key, i) => key === i);
      const stringsInOrder = manyNames.slice(600).every((key, i) => key === `key${i}`);
      console.log("indices first, ascending:", indicesAscend);
      console.log("then strings, in insertion order:", stringsInOrder);

      console.log("====== Proxy");
      const traps = [];
      const trapKey = key => (typeof key === "symbol" ? `symbol(${key.description})` : key);
      const logging = new Proxy(createMixedObject(), {
        ownKeys(target) {
          traps.push("ownKeys");
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          traps.push(`getOwnPropertyDescriptor ${trapKey(key)}`);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get(target, key) {
          traps.push(`get ${trapKey(key)}`);
          return undefined;
        },
        has(target, key) {
          traps.push(`has ${trapKey(key)}`);
          return Reflect.has(target, key);
        },
      });
      for (const filter of [
        undefined,
        ALL_PROPERTIES,
        ONLY_WRITABLE,
        ONLY_ENUMERABLE,
        ONLY_CONFIGURABLE,
        ONLY_WRITABLE | ONLY_CONFIGURABLE,
        SKIP_STRINGS,
        SKIP_SYMBOLS,
        ONLY_ENUMERABLE | SKIP_STRINGS,
        SKIP_STRINGS | SKIP_SYMBOLS,
        ONLY_ENUMERABLE | SKIP_STRINGS | SKIP_SYMBOLS,
      ]) {
        traps.length = 0;
        show("proxy with every trap", logging, filter);
        console.log("traps:", traps.join(", "));
      }
      show("proxy with every trap", logging, ALL_PROPERTIES, kConvertToString);

      const noTraps = new Proxy(createMixedObject(), {});
      for (const filter of attributeFilters) show("proxy without traps", noTraps, filter);
      show("proxy of a proxy", new Proxy(noTraps, {}));
      show("proxy of an array", new Proxy(["a", "b"], {}), ONLY_CONFIGURABLE);
      show("proxy of a String object", new Proxy(new String("ab"), {}), ONLY_WRITABLE);

      // the trap decides the order, and its keys do not have to exist
      const invented = ["z", "10", "2", Symbol.for("invented"), "a", "4294967294", "4294967295", "01"];
      const inventsKeys = new Proxy({}, { ownKeys: () => invented });
      for (const filter of [undefined, ALL_PROPERTIES, ONLY_ENUMERABLE, SKIP_STRINGS, SKIP_SYMBOLS]) {
        show("proxy that invents keys", inventsKeys, filter);
      }
      show("proxy that invents keys", inventsKeys, ALL_PROPERTIES, kConvertToString);
      const inventsProperties = new Proxy(
        {},
        {
          ownKeys: () => [...invented, "hidden"],
          getOwnPropertyDescriptor: (target, key) => ({
            value: 1,
            writable: false,
            enumerable: key !== "hidden",
            configurable: true,
          }),
        },
      );
      for (const filter of [...attributeFilters, ONLY_ENUMERABLE | SKIP_STRINGS]) {
        show("proxy that invents read-only properties", inventsProperties, filter);
      }

      // Bun only: a collection in the middle of the native call, after some of the keys were chosen
      const collecting = new Proxy(
        { a: 1, b: 2, 3: 3, [symbols.enumerable]: 4 },
        {
          getOwnPropertyDescriptor(target, key) {
            if (process.isBun) Bun.gc(true);
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        },
      );
      show("proxy whose trap collects garbage", collecting, ONLY_ENUMERABLE);

      console.log("====== exceptions");
      const throwsFromOwnKeys = new Proxy(
        {},
        {
          ownKeys() {
            throw new TrapError("ownKeys threw");
          },
        },
      );
      for (const filter of [undefined, ALL_PROPERTIES, SKIP_STRINGS, SKIP_STRINGS | SKIP_SYMBOLS]) {
        show("proxy with a throwing ownKeys trap", throwsFromOwnKeys, filter);
      }
      const throwsFromDescriptor = new Proxy(
        { a: 1, [symbols.enumerable]: 1 },
        {
          getOwnPropertyDescriptor() {
            throw new TrapError("getOwnPropertyDescriptor threw");
          },
        },
      );
      for (const filter of [
        undefined,
        ALL_PROPERTIES,
        ONLY_WRITABLE,
        ONLY_ENUMERABLE,
        ONLY_CONFIGURABLE,
        SKIP_STRINGS,
        ONLY_ENUMERABLE | SKIP_STRINGS,
        ONLY_ENUMERABLE | SKIP_STRINGS | SKIP_SYMBOLS,
      ]) {
        show("proxy with a throwing getOwnPropertyDescriptor trap", throwsFromDescriptor, filter);
      }
      const { proxy: revoked, revoke } = Proxy.revocable({}, {});
      revoke();
      show("revoked proxy", revoked);
      show("revoked proxy", revoked, ALL_PROPERTIES);
      show("proxy whose ownKeys trap returns a number", new Proxy({}, { ownKeys: () => [1] }), ALL_PROPERTIES);
      show("proxy whose ownKeys trap repeats a key", new Proxy({}, { ownKeys: () => ["a", "a"] }), ALL_PROPERTIES);
      const hidesKey = new Proxy(Object.preventExtensions({ a: 1 }), { ownKeys: () => [] });
      show("proxy whose ownKeys trap hides a key of a non-extensible target", hidesKey, ALL_PROPERTIES);
    },

    test_v8_object_clone() {
      let getterCalls = 0;
      const getter = () => {
        getterCalls++;
        return "value from the getter";
      };
      const setter = value => {};
      const symbol = Symbol("symbol key");
      const nested = { shared: true };
      class Base {
        method() {
          return "method on the prototype";
        }
      }
      // One entry per own property: its key, what it holds, and a letter for each of writable,
      // enumerable and configurable that it is.
      const describe = object =>
        Reflect.ownKeys(object)
          .map(key => {
            const d = Object.getOwnPropertyDescriptor(object, key);
            const holds =
              "value" in d
                ? JSON.stringify(d.value)
                : `accessor (same getter: ${d.get === getter}, same setter: ${d.set === setter})`;
            const attributes = (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
            return `${key === symbol ? "[symbol]" : String(key)} = ${holds} ${attributes}`;
          })
          .join(", ");

      // The properties added after the literal do not all fit in the object itself.
      const withData = { number: 1, string: "two", nested };
      for (const name of ["third", "fourth", "fifth", "sixth"]) withData[name] = name;

      const instance = new Base();
      instance.data = "data value";
      instance.nested = nested;
      instance[symbol] = "symbol value";
      instance[1] = "index value";
      Object.defineProperty(instance, "hidden", { value: "non-enumerable", writable: true, configurable: true });
      Object.defineProperty(instance, "accessor", { get: getter, set: setter, enumerable: true, configurable: true });

      // JSC gives an object with this many properties a property table of its own, which a copy cannot share.
      const manyProperties = { nested };
      for (let i = 0; i < 300; i++) manyProperties["p" + i] = i;
      for (let i = 0; i < 300; i += 3) delete manyProperties["p" + i];

      // Bun copies an object that has an index key by defining each of its properties on a new object.
      const frozen = Object.freeze({ 0: "index value", data: "data value", nested });
      const withoutPrototype = Object.assign(Object.create(null), { 0: "index value", data: "data value", nested });

      for (const [description, original] of [
        ["object with data properties", withData],
        ["class instance with index, data, non-enumerable, accessor and symbol properties", instance],
        ["object with hundreds of properties, some deleted", manyProperties],
        ["frozen object with an index key", frozen],
        ["object without a prototype, with an index key", withoutPrototype],
      ]) {
        console.log(`====== ${description}`);
        const before = describe(original);
        const copy = nativeModule.perform_object_clone(original);
        console.log("copy is another object:", copy !== original);
        console.log("same prototype:", Object.getPrototypeOf(copy) === Object.getPrototypeOf(original));
        console.log("own properties of the copy:", describe(copy));
        console.log("same as the original's:", describe(copy) === before);
        console.log(
          "extensible, sealed, frozen:",
          Object.isExtensible(copy),
          Object.isSealed(copy),
          Object.isFrozen(copy),
        );
        console.log("nested object is shared:", copy.nested === nested);
        if (original === instance) {
          console.log("getter calls during Clone():", getterCalls);
          console.log("accessor read on the copy:", copy.accessor);
          console.log("method called on the copy:", copy.method());
        }

        // Writes to either object must not show up in the other.
        const keys = Reflect.ownKeys(original);
        const [first, last] = [keys[0], keys[keys.length - 1]];
        copy[first] = copy[last] = "changed on the copy";
        copy.addedToCopy = true;
        delete copy.nested;
        const copyAfter = describe(copy);
        console.log("copy after writing to it:", copyAfter);
        console.log("original is unchanged:", describe(original) === before);
        original[first] = original[last] = "changed on the original";
        original.addedToOriginal = true;
        console.log("copy is unchanged by writing to the original:", describe(copy) === copyAfter);
      }
    },

    test_v8_object_clone_template_instance() {
      for (const [how, useFunctionTemplate] of [
        ["ObjectTemplate::NewInstance()", false],
        ["FunctionTemplate::GetFunction()->NewInstance()", true],
      ]) {
        console.log(`====== object made by ${how}`);
        const [original, copy] = nativeModule.clone_template_instance(useFunctionTemplate);
        console.log("copy is another object:", copy !== original);
        console.log("same prototype:", Object.getPrototypeOf(copy) === Object.getPrototypeOf(original));
        console.log("own keys of the copy:", Object.keys(copy).join(", "));
        console.log("copy.describeInternalFields():", copy.describeInternalFields());
        console.log("original.describeInternalFields():", original.describeInternalFields());

        copy.own = "changed on the copy";
        copy.addedToCopy = true;
        original.addedToOriginal = true;
        console.log("original after writing properties of both:", JSON.stringify(original));
        console.log("copy after writing properties of both:", JSON.stringify(copy));

        // An index key is an own property like the others, and the engine stores it differently.
        copy[0] = "index value";
        const copyOfCopy = nativeModule.perform_object_clone(copy);
        console.log("copy of the copy with an index key:", JSON.stringify(copyOfCopy));
        console.log("same prototype:", Object.getPrototypeOf(copyOfCopy) === Object.getPrototypeOf(copy));
        console.log("copyOfCopy.describeInternalFields():", copyOfCopy.describeInternalFields());

        // `original` has no index key and `copy` has one.
        for (const [description, source] of [
          ["the original", original],
          ["the copy with an index key", copy],
          ["an object with data properties", { number: 1, string: "two" }],
        ]) {
          try {
            nativeModule.perform_object_clone_with_pending_exception(source);
            console.log(`cloning ${description} did not throw`);
          } catch (e) {
            console.log(`cloning ${description}: caught`, e.message);
          }
        }
      }
    },
  };
};

// Calls perform, a native function that prints one conversion to a number, on
// every value of the list that NumberValue and Uint32Value are compared on.
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

import { structuredCloneAdvanced } from "bun:internal-for-testing";
import { deserialize, serialize } from "bun:jsc";
import { bunEnv, bunExe } from "harness";

enum TransferMode {
  no = 0,
  yes_in_transfer_list = 1,
  yes_but_not_in_transfer_list = 2,
}

const testTypes = [
  {
    name: "ArrayBuffer (transferable)",
    createValue: () => {
      const buf = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
      return buf.buffer.transfer();
    },
    isTransferable: true,
    expectedAfterClone: (original: ArrayBuffer, cloned: any, isTransfer: TransferMode, isStorage: boolean) => {
      expect(cloned).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(cloned)).toStrictEqual(new Uint8Array([21, 11, 96, 126, 243, 128, 164]));
      if (isTransfer === TransferMode.yes_in_transfer_list) {
        // Original should be detached after transfer
        expect(original.byteLength).toBe(0);
      }
    },
  },
  {
    name: "BunFile (cloneable, non-transferable)",
    createValue: () => Bun.file(import.meta.filename),
    isTransferable: false,
    expectedAfterClone: (original: any, cloned: any, isTransfer: TransferMode, isStorage: boolean) => {
      expect(original).toBeInstanceOf(Blob);
      expect(original.name).toEqual(import.meta.filename);
      expect(original.type).toEqual("text/javascript;charset=utf-8");

      if (isTransfer || isStorage) {
        // Non-transferable types should yield an empty object when transferred
        expect(cloned).toBeEmptyObject();
      } else {
        // When not stored or transferred, BunFile maintains its properties
        expect(cloned.name).toBe(original.name);
        expect(cloned.type).toBe(original.type);
      }
    },
  },
  {
    name: "net.BlockList (cloneable, non-transferable)",
    createValue: () => {
      const { BlockList } = require("net");
      const blocklist = new BlockList();
      blocklist.addAddress("123.123.123.123");
      return blocklist;
    },
    isTransferable: false,
    expectedAfterClone: (original: any, cloned: any, isTransfer: TransferMode, isStorage: boolean) => {
      if (isStorage || isTransfer !== TransferMode.no) {
        // BlockList loses its internal state when stored
        expect(cloned.rules).toBeUndefined();
        expect(cloned).toBeEmptyObject();
      } else {
        // When not stored or transferred, BlockList maintains its properties
        expect(cloned).toHaveProperty("rules");
        expect(cloned.check("123.123.123.123")).toBe(true);
      }
    },
  },
];

describe("serialize & deserialize", () => {
  for (const testType of testTypes) {
    test(`${testType.name}`, async () => {
      const original = testType.createValue();
      const serialized = serialize(original);

      const result = Bun.spawnSync({
        cmd: [
          bunExe(),
          "-e",
          `
        import {deserialize, serialize} from "bun:jsc";
        const serialized = deserialize(await Bun.stdin.bytes());
        const cloned = serialize(serialized);
        process.stdout.write(cloned);
        `,
        ],
        env: bunEnv,
        stdin: serialized,
        stdout: "pipe",
        stderr: "inherit",
      });
      const cloned = deserialize(result.stdout);
      testType.expectedAfterClone(original, cloned, TransferMode.no, true);
    });
  }
});

const contexts = ["default", "worker", "window"] as const;
const transferModes = [
  TransferMode.yes_but_not_in_transfer_list,
  TransferMode.yes_in_transfer_list,
  TransferMode.no,
] as const;
const storageModes = [true, false] as const;

for (const testType of testTypes) {
  for (const context of contexts) {
    for (const isForTransfer of transferModes) {
      for (const isForStorage of storageModes) {
        test(`${testType.name} - context: ${context}, transfer: ${TransferMode[isForTransfer]}, storage: ${isForStorage}`, () => {
          const original = testType.createValue();

          if (isForTransfer === TransferMode.yes_in_transfer_list) {
            // Test with transfer list (even for non-transferable types)
            const transferList = [original];
            if (!testType.isTransferable) {
              expect(() =>
                structuredCloneAdvanced(original, transferList, !!isForTransfer, isForStorage, context),
              ).toThrowError("The object can not be cloned.");
            } else {
              const cloned = structuredCloneAdvanced(original, transferList, !!isForTransfer, isForStorage, context);
              testType.expectedAfterClone(original, cloned, isForTransfer, isForStorage);
            }
          } else if (isForTransfer === TransferMode.yes_but_not_in_transfer_list) {
            const cloned = structuredCloneAdvanced(original, [], !!isForTransfer, isForStorage, context);
            testType.expectedAfterClone(original, cloned, isForTransfer, isForStorage);
          } else {
            // Test without transfer list
            const cloned = structuredCloneAdvanced(original, [], !!isForTransfer, isForStorage, context);
            testType.expectedAfterClone(original, cloned, isForTransfer, isForStorage);
          }
        });
      }
    }
  }
}

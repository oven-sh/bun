import { $, ShellOutput, ShellPromise } from "bun";
import { bunExe, bunEnv as env, toBeValidBin, toHaveBins, toBeWorkspaceLink, tempDirWithFiles, bunEnv } from "harness";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, describe, test, setDefaultTimeout } from "bun:test";
import { join, sep } from "path";

describe("bun patch <pkg>", async () => {
  test("should patch a package when it is already patched", async () => {
    const tempdir = tempDirWithFiles("lol", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
          "is-odd": "3.0.1",
        },
      }),
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);
    const { stderr } = await $`${bunExe()} patch is-odd@0.1.2`.env(bunEnv).cwd(tempdir).throws(false);
    expect(stderr.toString()).not.toContain("error");

    const firstChange = /* ts */ `/*!
* is-odd <https://github.com/jonschlinkert/is-odd>
*
* Copyright (c) 2015-2017, Jon Schlinkert.
* Released under the MIT License.
*/

'use strict';

var isNumber = require('is-number');

module.exports = function isOdd(i) {
  if (!isNumber(i)) {
    throw new TypeError('is-odd expects a number.');
  }
  if (Number(i) !== Math.floor(i)) {
    throw new RangeError('is-odd expects an integer.');
  }
  console.log('hi')
  return !!(~~i & 1);
};`;

    await $`echo ${firstChange} > node_modules/is-even/node_modules/is-odd/index.js`.env(bunEnv).cwd(tempdir);

    const { stderr: stderr2 } = await $`${bunExe()} patch --commit node_modules/is-even/node_modules/is-odd`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);
    expect(stderr2.toString()).not.toContain("error");

    const { stderr: stderr3 } = await $`${bunExe()} patch is-odd@0.1.2`.env(bunEnv).cwd(tempdir).throws(false);
    expect(stderr3.toString()).not.toContain("error");

    const secondChange = /* ts */ `/*!
* is-odd <https://github.com/jonschlinkert/is-odd>
*
* Copyright (c) 2015-2017, Jon Schlinkert.
* Released under the MIT License.
*/

'use strict';

var isNumber = require('is-number');

module.exports = function isOdd(i) {
  if (!isNumber(i)) {
    throw new TypeError('is-odd expects a number.');
  }
  if (Number(i) !== Math.floor(i)) {
    throw new RangeError('is-odd expects an integer.');
  }
  console.log('hi')
  console.log('hello')
  return !!(~~i & 1);
};`;

    await $`echo ${secondChange} > node_modules/is-even/node_modules/is-odd/index.js`.env(bunEnv).cwd(tempdir);
    const { stderr: stderr4 } = await $`${bunExe()} patch --commit node_modules/is-even/node_modules/is-odd`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);
    expect(stderr4.toString()).not.toContain("error");

    await $`cat patches/is-odd@0.1.2.patch`.env(bunEnv).cwd(tempdir);

    await $`${bunExe()} i`.env(bunEnv).cwd(tempdir).throws(false);
    const { stdout } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir).throws(false);
    expect(stdout.toString()).toContain("hi\nhello\n");
  });

  test("bad patch arg", async () => {
    const tempdir = tempDirWithFiles("lol", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);
    const { stderr, exitCode } = await $`${bunExe()} patch lkflksdkfj`.env(bunEnv).cwd(tempdir).throws(false);
    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("error: package lkflksdkfj not found");
  });

  test("bad patch commit arg", async () => {
    const tempdir = tempDirWithFiles("lol", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);
    const { stderr } = await $`${bunExe()} patch is-even`.env(bunEnv).cwd(tempdir);
    expect(stderr.toString()).not.toContain("error");

    const { stderr: stderr2 } = await $`${bunExe()} patch --commit lskfjdslkfjsldkfjlsdkfj`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);
    expect(stderr2.toString()).toContain("error: package lskfjdslkfjsldkfjlsdkfj not found");
  });

  function makeTest(
    name: string,
    {
      dependencies,
      mainScript,
      patchArg,
      patchedCode,
      expected,
    }: {
      dependencies: Record<string, string>;
      mainScript: string;
      patchArg: string;
      patchedCode: string;
      expected: { patchName: string; patchPath: string; stdout: string };
      extra?: (filedir: string) => Promise<void>;
    },
  ) {
    test(name, async () => {
      $.throws(true);

      const filedir = tempDirWithFiles("patch1", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": dependencies,
        }),
        "index.ts": mainScript,
      });

      {
        const { stderr } = await $`${bunExe()} i`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).not.toContain("error");
      }

      {
        const { stderr, stdout } = await $`${bunExe()} patch ${patchArg}`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).not.toContain("error");
        expect(stdout.toString()).toContain(
          `To patch ${expected.patchName}, edit the following folder:

  ${expected.patchPath}

Once you're done with your changes, run:

  bun patch --commit '${expected.patchPath}'`,
        );
      }

      {
        const newCode = patchedCode;

        await $`echo ${newCode} > ${expected.patchPath}/index.js`.env(bunEnv).cwd(filedir);
        const { stderr, stdout } = await $`${bunExe()} patch --commit ${expected.patchPath}`.env(bunEnv).cwd(filedir);
      }

      const output = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir).text();
      expect(output).toBe(expected.stdout);
    });
  }

  ["is-even@1.0.0", "node_modules/is-even"].map(patchArg =>
    makeTest("should patch a node_modules package", {
      dependencies: { "is-even": "1.0.0" },
      mainScript: /* ts */ `import isEven from 'is-even'; isEven(420)`,
      patchArg,
      patchedCode: /* ts */ `/*!
      * is-even <https://github.com/jonschlinkert/is-even>
      *
      * Copyright (c) 2015, 2017, Jon Schlinkert.
      * Released under the MIT License.
      */

     'use strict';

     var isOdd = require('is-odd');

     module.exports = function isEven(i) {
       console.log("If you're reading this, the patch worked!")
       return !isOdd(i);
     };
     `,
      expected: {
        patchName: "is-even",
        patchPath: "node_modules/is-even",
        stdout: "If you're reading this, the patch worked!\n",
      },
    }),
  );

  ["is-odd@0.1.2", "node_modules/is-even/node_modules/is-odd"].map(patchArg =>
    makeTest("should patch a nested node_modules package", {
      dependencies: { "is-even": "1.0.0", "is-odd": "3.0.1" },
      mainScript: /* ts */ `import isEven from 'is-even'; isEven(420)`,
      patchArg,
      patchedCode: /* ts */ `/*!
      * is-odd <https://github.com/jonschlinkert/is-odd>
      *
      * Copyright (c) 2015-2017, Jon Schlinkert.
      * Released under the MIT License.
      */

     'use strict';

     var isNumber = require('is-number');

     module.exports = function isOdd(i) {
       if (!isNumber(i)) {
         throw new TypeError('is-odd expects a number.');
       }
       if (Number(i) !== Math.floor(i)) {
         throw new RangeError('is-odd expects an integer.');
       }
       console.log("If you're reading this, the patch worked.")
       return !!(~~i & 1);
     };
     `,
      expected: {
        patchName: "is-odd",
        patchPath: "node_modules/is-even/node_modules/is-odd",
        stdout: "If you're reading this, the patch worked.\n",
      },
      extra: async filedir => {
        const patchfile = await $`cat ${join(filedir, "patches", "is-odd@0.1.2.patch")}`.cwd(filedir).text();
        // ensure node modules is not in the patch
        expect(patchfile).not.toContain("node_modules");
      },
    }),
  );

  test("should overwrite the node_modules folder of the package", async () => {
    const patchArgs = ["is-even@1.0.0", "node_modules/is-even"];

    for (const patchArg of patchArgs) {
      $.throws(true);

      const filedir = tempDirWithFiles("patch1", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven())`,
      });

      {
        const { stderr } = await $`${bunExe()} i --backend hardlink`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toContain("Saved lockfile");

        const newCode = /* ts */ `
module.exports = function isEven() {
  return 'LOL'
}
`;

        await $`${bunExe()} patch ${patchArg}`.env(bunEnv).cwd(filedir);
        await $`echo ${newCode} > node_modules/is-even/index.js`.env(bunEnv).cwd(filedir);
      }

      const tempdir = tempDirWithFiles("unpatched", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
      });

      await $`${bunExe()} run index.ts`
        .env(bunEnv)
        .cwd(filedir)
        .then(o => expect(o.stderr.toString()).toBe(""));

      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toBe("true\n");
    }
  });

  test("should overwrite nested node_modules folder of the package", async () => {
    const patchArgs = ["is-odd@0.1.2", "node_modules/is-even/node_modules/is-odd"];

    for (const patchArg of patchArgs) {
      $.throws(true);

      const filedir = tempDirWithFiles("patch1", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
            "is-odd": "3.0.1",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven())`,
      });

      {
        const { stderr } = await $`${bunExe()} i --backend hardlink`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toContain("Saved lockfile");

        const newCode = /* ts */ `
module.exports = function isOdd() {
  return 'LOL'
}
`;

        await $`ls -d node_modules/is-even/node_modules/is-odd`.cwd(filedir);
        await $`${bunExe()} patch ${patchArg}`.env(bunEnv).cwd(filedir);
        await $`echo ${newCode} > node_modules/is-even/node_modules/is-odd/index.js`.env(bunEnv).cwd(filedir);
      }

      const tempdir = tempDirWithFiles("unpatched", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
      });

      await $`${bunExe()} run index.ts`
        .env(bunEnv)
        .cwd(filedir)
        .then(o => expect(o.stderr.toString()).toBe(""));

      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toBe("true\n");
    }
  });
});

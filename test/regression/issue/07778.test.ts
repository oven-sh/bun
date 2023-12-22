import { bunRunAsScript } from "harness";
import { tempDirWithFiles } from "harness";
import path from "path";

it("has import.meta behaviour that matches node.js behaviour", () => {

    const fileData = `
    console.log(import.meta.dir);
    console.log(import.meta.dirname);
    console.log(import.meta.file);
    console.log(import.meta.filename);
    `;

    const testDir = tempDirWithFiles("07778", {
        'test.mjs': fileData,
    })

    const { stdout, stderr } = bunRunAsScript(testDir, 'test.mjs');

    expect(stdout).toBeDefined();

    const [ dir, dirname, file, filename ] = stdout.split("\n");

    expect(dir).toEqual(testDir);
    expect(dirname).toEqual(testDir);

    expect(file).toEqual("test.mjs");
    expect(filename).toEqual(path.join(testDir, "test.mjs"));

    expect(stderr).toBeDefined();
})

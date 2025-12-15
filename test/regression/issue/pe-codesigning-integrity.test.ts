import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync, unlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

describe.if(isWindows)("PE codesigning integrity", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = tempDirWithFiles("pe-codesigning", {});
  });

  afterAll(() => {
    // Cleanup any test executables
    try {
      unlinkSync(join(tempDir, "test-pe-simple.exe"));
      unlinkSync(join(tempDir, "test-pe-large.exe"));
    } catch {}
  });

  // PE file parsing utilities using DataView
  class PEParser {
    private view: DataView;
    private buffer: ArrayBuffer;

    constructor(data: Uint8Array) {
      this.buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      this.view = new DataView(this.buffer);
    }

    // Parse DOS header
    parseDOSHeader() {
      const dosSignature = this.view.getUint16(0, true); // "MZ" = 0x5A4D
      const e_lfanew = this.view.getUint32(60, true); // Offset to PE header

      return {
        signature: dosSignature,
        e_lfanew,
        isValid: dosSignature === 0x5a4d && e_lfanew > 0 && e_lfanew < 0x1000,
      };
    }

    // Parse PE header
    parsePEHeader(offset: number) {
      const peSignature = this.view.getUint32(offset, true); // "PE\0\0" = 0x00004550
      const machine = this.view.getUint16(offset + 4, true);
      const numberOfSections = this.view.getUint16(offset + 6, true);
      const sizeOfOptionalHeader = this.view.getUint16(offset + 20, true);

      return {
        signature: peSignature,
        machine,
        numberOfSections,
        sizeOfOptionalHeader,
        isValid: peSignature === 0x00004550 && numberOfSections > 0,
      };
    }

    // Parse optional header (PE32+)
    parseOptionalHeader(offset: number) {
      const magic = this.view.getUint16(offset, true); // 0x020B for PE32+
      const sizeOfImage = this.view.getUint32(offset + 56, true);
      const fileAlignment = this.view.getUint32(offset + 36, true);
      const sectionAlignment = this.view.getUint32(offset + 32, true);

      return {
        magic,
        sizeOfImage,
        fileAlignment,
        sectionAlignment,
        isValid: magic === 0x020b,
      };
    }

    // Parse section headers
    parseSectionHeaders(offset: number, count: number) {
      const sections: {
        name: string;
        virtualSize: number;
        virtualAddress: number;
        sizeOfRawData: number;
        pointerToRawData: number;
        characteristics: number;
        isValid: boolean;
      }[] = [];

      for (let i = 0; i < count; i++) {
        const sectionOffset = offset + i * 40; // Each section header is 40 bytes

        // Read section name (8 bytes)
        const nameBytes = new Uint8Array(this.buffer, sectionOffset, 8);
        const name = new TextDecoder().decode(nameBytes).replace(/\0/g, "");

        const virtualSize = this.view.getUint32(sectionOffset + 8, true);
        const virtualAddress = this.view.getUint32(sectionOffset + 12, true);
        const sizeOfRawData = this.view.getUint32(sectionOffset + 16, true);
        const pointerToRawData = this.view.getUint32(sectionOffset + 20, true);
        const characteristics = this.view.getUint32(sectionOffset + 36, true);

        sections.push({
          name,
          virtualSize,
          virtualAddress,
          sizeOfRawData,
          pointerToRawData,
          characteristics,
          isValid: sizeOfRawData > 0 && pointerToRawData > 0,
        });
      }

      return sections;
    }

    // Find and validate .bun section
    findBunSection(sections: any[]) {
      const bunSection = sections.find(s => s.name === ".bun");
      if (!bunSection) return null;

      // Read the .bun section data
      const sectionData = new Uint8Array(this.buffer, bunSection.pointerToRawData, bunSection.sizeOfRawData);

      // First 8 bytes should be the data size (u64 for 8-byte alignment)
      const dataSize = Number(new DataView(sectionData.buffer, bunSection.pointerToRawData).getBigUint64(0, true));

      // Validate the size is reasonable - it should match or be close to virtual size
      if (dataSize > bunSection.sizeOfRawData || dataSize === 0) {
        throw new Error(`Invalid .bun section: data size ${dataSize} vs section size ${bunSection.sizeOfRawData}`);
      }

      // The virtual size should match the data size (plus some alignment)
      if (dataSize > bunSection.virtualSize + 16) {
        // Allow some padding
        throw new Error(`Invalid .bun section: data size ${dataSize} exceeds virtual size ${bunSection.virtualSize}`);
      }

      // Extract the actual embedded data (skip the 8-byte size header)
      const embeddedData = sectionData.slice(8, 8 + dataSize);

      return {
        section: bunSection,
        dataSize,
        embeddedData,
        isValid: dataSize > 0 && dataSize <= bunSection.virtualSize,
      };
    }

    // Full PE validation
    validatePE() {
      const dos = this.parseDOSHeader();
      if (!dos.isValid) throw new Error("Invalid DOS header");

      const pe = this.parsePEHeader(dos.e_lfanew);
      if (!pe.isValid) throw new Error("Invalid PE header");

      const optionalHeaderOffset = dos.e_lfanew + 24; // PE header is 24 bytes
      const optional = this.parseOptionalHeader(optionalHeaderOffset);
      if (!optional.isValid) throw new Error("Invalid optional header");

      const sectionsOffset = optionalHeaderOffset + pe.sizeOfOptionalHeader;
      const sections = this.parseSectionHeaders(sectionsOffset, pe.numberOfSections);

      const bunSection = this.findBunSection(sections);
      if (!bunSection) throw new Error(".bun section not found");

      return {
        dos,
        pe,
        optional,
        sections,
        bunSection,
      };
    }
  }

  it("should create valid PE executable with .bun section", async () => {
    const testContent = `
console.log("Hello from PE codesigning test!");
console.log("Testing PE file integrity with DataView");

const data = {
  message: "PE integrity test",
  timestamp: ${Date.now()},
  randomData: "x".repeat(100)
};

console.log("Test data:", JSON.stringify(data));
    `.trim();

    // Write test file
    const testFile = join(tempDir, "test-pe-simple.js");
    await Bun.write(testFile, testContent);

    // Compile to Windows PE executable
    const result = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", testFile],
      env: bunEnv,
      cwd: tempDir,
    });

    await result.exited;
    expect(result.exitCode).toBe(0);

    // Read the generated PE file
    const exePath = join(tempDir, "test-pe-simple.exe");
    const peData = readFileSync(exePath);

    // Parse and validate PE structure
    const parser = new PEParser(peData);
    const validation = parser.validatePE();

    // Validate DOS header
    expect(validation.dos.signature).toBe(0x5a4d); // "MZ"
    expect(validation.dos.e_lfanew).toBeGreaterThan(0);
    expect(validation.dos.e_lfanew).toBeLessThan(0x1000);

    // Validate PE header
    expect(validation.pe.signature).toBe(0x00004550); // "PE\0\0"
    expect(validation.pe.machine).toBe(0x8664); // x64
    expect(validation.pe.numberOfSections).toBeGreaterThan(0);

    // Validate optional header
    expect(validation.optional.magic).toBe(0x020b); // PE32+
    expect(validation.optional.fileAlignment).toBeGreaterThan(0);
    expect(validation.optional.sectionAlignment).toBeGreaterThan(0);

    // Validate sections exist
    expect(validation.sections.length).toBeGreaterThan(0);
    expect(validation.sections.every(s => s.isValid)).toBe(true);

    // Validate .bun section
    expect(validation.bunSection).not.toBeNull();
    expect(validation.bunSection!.isValid).toBe(true);
    expect(validation.bunSection!.dataSize).toBeGreaterThan(0);

    // Validate embedded data contains our test content
    // The embedded data is in StandaloneModuleGraph format, which includes:
    // - Virtual path (B:/~BUN/root/filename)
    // - JavaScript source code
    // - Binary metadata and trailer
    const embeddedText = new TextDecoder().decode(validation.bunSection!.embeddedData);
    expect(embeddedText).toContain("B:/~BUN/root/"); // Windows virtual path
    expect(embeddedText).toContain("Hello from PE codesigning test!");
    expect(embeddedText).toContain("PE integrity test");
    expect(embeddedText).toContain("---- Bun! ----"); // Trailer signature
  });

  it("should handle large embedded data correctly", async () => {
    // Create a larger test file to verify handling of bigger data
    const largeContent = `
console.log("Large PE test");

// Generate some substantial content
const largeData = {
  message: "Large data test",
  content: "${"x".repeat(5000)}", // 5KB of data
  array: ${JSON.stringify(Array.from({ length: 100 }, (_, i) => `item-${i}`))},
  timestamp: ${Date.now()}
};

console.log("Large data length:", JSON.stringify(largeData).length);
    `.trim();

    const testFile = join(tempDir, "test-pe-large.js");
    await Bun.write(testFile, largeContent);

    const result = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", testFile],
      env: bunEnv,
      cwd: tempDir,
    });

    await result.exited;
    expect(result.exitCode).toBe(0);

    // Read and validate the larger PE file
    const exePath = join(tempDir, "test-pe-large.exe");
    const peData = readFileSync(exePath);

    const parser = new PEParser(peData);
    const validation = parser.validatePE();

    // Basic PE validation
    expect(validation.dos.isValid).toBe(true);
    expect(validation.pe.isValid).toBe(true);
    expect(validation.optional.isValid).toBe(true);

    // .bun section should contain the larger data
    expect(validation.bunSection).not.toBeNull();
    expect(validation.bunSection!.dataSize).toBeGreaterThan(1000); // Should be substantial

    const embeddedText = new TextDecoder().decode(validation.bunSection!.embeddedData);
    expect(embeddedText).toContain("B:/~BUN/root/"); // Virtual path
    expect(embeddedText).toContain("Large PE test");
    expect(embeddedText).toContain("Large data test");
    expect(embeddedText).toContain("---- Bun! ----"); // Trailer
  });

  it("should align sections properly", async () => {
    const testFile = join(tempDir, "test-pe-alignment.js");
    await Bun.write(testFile, 'console.log("Alignment test");');

    const result = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", testFile],
      env: bunEnv,
      cwd: tempDir,
    });

    await result.exited;
    expect(result.exitCode).toBe(0);

    const exePath = join(tempDir, "test-pe-alignment.exe");
    const peData = readFileSync(exePath);

    const parser = new PEParser(peData);
    const validation = parser.validatePE();

    // Check that sections are properly aligned
    const fileAlignment = validation.optional.fileAlignment;
    const sectionAlignment = validation.optional.sectionAlignment;

    for (const section of validation.sections) {
      // File offset should be aligned to file alignment
      expect(section.pointerToRawData % fileAlignment).toBe(0);

      // Virtual address should be aligned to section alignment
      expect(section.virtualAddress % sectionAlignment).toBe(0);
    }

    // .bun section should also be properly aligned
    const bunSection = validation.bunSection!.section;
    expect(bunSection.pointerToRawData % fileAlignment).toBe(0);
    expect(bunSection.virtualAddress % sectionAlignment).toBe(0);

    // Cleanup
    unlinkSync(testFile);
    unlinkSync(exePath);
  });

  it("should have correct section characteristics", async () => {
    const testFile = join(tempDir, "test-pe-characteristics.js");
    await Bun.write(testFile, 'console.log("Characteristics test");');

    const result = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", testFile],
      env: bunEnv,
      cwd: tempDir,
    });

    await result.exited;
    expect(result.exitCode).toBe(0);

    const exePath = join(tempDir, "test-pe-characteristics.exe");
    const peData = readFileSync(exePath);

    const parser = new PEParser(peData);
    const validation = parser.validatePE();

    // Find .bun section and check its characteristics
    const bunSection = validation.bunSection!.section;

    // .bun section should have IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ
    const IMAGE_SCN_CNT_INITIALIZED_DATA = 0x00000040;
    const IMAGE_SCN_MEM_READ = 0x40000000;
    const expectedCharacteristics = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ;

    expect(bunSection.characteristics & expectedCharacteristics).toBe(expectedCharacteristics);

    // Should NOT have execute permissions
    const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
    expect(bunSection.characteristics & IMAGE_SCN_MEM_EXECUTE).toBe(0);

    // Cleanup
    unlinkSync(testFile);
    unlinkSync(exePath);
  });
});

console.log("Testing YAML parsing...");

try {
    const yamlResult = Bun.YAML.parse("key: value");
    console.log("YAML result:", JSON.stringify(yamlResult, null, 2));
} catch (e) {
    console.log("YAML error:", e.message);
}
const input = await Bun.stdin.text();

if (process.platform == "win32") {
  // powershell unavoidably appends \r\n to text sent from a powershell command (like Get-Content)
  // to an external program (like bun)
  // https://github.com/PowerShell/PowerShell/issues/5974
  // so we have to remove it
  // for sanity check that it actually ends in \r\n
  const CR = "\r".charCodeAt(0);
  const LF = "\n".charCodeAt(0);
  if (input.charCodeAt(input.length - 2) !== CR || input.charCodeAt(input.length - 1) !== LF) {
    throw new Error(`input of ${input.length} bytes does not end in CRLF`);
  }
  const trimmed = input.substring(0, input.length - 2);
  console.write(trimmed);
} else {
  console.write(input);
}

const report: any = process.report.getReport();
console.log(Object.keys(report).sort().join(" "));
console.log(
  typeof report.header.nodejsVersion,
  report.header.arch === process.arch,
  Array.isArray(report.sharedObjects),
);

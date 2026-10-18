console.log(typeof postMessage);
try { (postMessage as any)({ a: 1 }); console.log("posted"); } catch (error: any) { console.log(error.name); }

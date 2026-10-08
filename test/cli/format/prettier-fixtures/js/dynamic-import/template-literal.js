module   =   await import(`data:text/javascript,
    console.log("RUN");
`);

module   =   await import(String.raw`data:text/javascript,
    console.log("RUN");
`);

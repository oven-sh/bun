const doBothThings = async () => {
    const request = doAsyncThing();
    return (await request)::doSyncThing();
};

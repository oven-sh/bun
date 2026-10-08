tap.test("RecordImport.advance", (t) => {
    const checkStates = (batches, states) => {
        t.equal(batches.length, states.length);
        for (const batch of batches) {
            t.equal(batch.state, states.shift());
            t.ok(batch.getCurState().name(i18n));
        }
    };

    const batch = init.getRecordBatch();
    const dataFile = path.resolve(process.cwd(), "testData", "default.json");

    const getBatches = (callback) => {
        RecordImport.find({}, "", {}, (err, batches) => {
            callback(null, batches.filter((batch) => (batch.state !== "error" &&
                batch.state !== "completed")));
        });
    };

    mockFS((callback) => {
        batch.setResults([fs.createReadStream(dataFile)], (err) => {
            t.error(err, "Error should be empty.");
            t.equal(batch.results.length, 6, "Check number of results");
            for (const result of batch.results) {
                t.equal(result.result, "unknown");
                t.ok(result.data);
                t.equal(result.data.lang, "en");
            }

            getBatches((err, batches) => {
                checkStates(batches, ["started"]);

                RecordImport.advance((err) => {
                    t.error(err, "Error should be empty.");

                    getBatches((err, batches) => {
                        checkStates(batches, ["process.completed"]);

                        // Need to manually move to the next step
                        batch.importRecords((err) => {
                            t.error(err, "Error should be empty.");

                            getBatches((err, batches) => {
                                checkStates(batches, ["import.completed"]);

                                RecordImport.advance((err) => {
                                    t.error(err, "Error should be empty.");

                                    getBatches((err, batches) => {
                                        checkStates(batches,
                                            ["similarity.sync.completed"]);

                                        RecordImport.advance((err) => {
                                            t.error(err,
                                                "Error should be empty.");

                                            t.ok(batch.getCurState()
                                                .name(i18n));

                                            getBatches((err, batches) => {
                                                checkStates(batches, []);
                                                t.end();
                                                callback();
                                            });
                                        });

                                        t.ok(batch.getCurState().name(i18n));
                                    });
                                });

                                t.ok(batch.getCurState().name(i18n));
                            });
                        });

                        t.ok(batch.getCurState().name(i18n));
                    });
                });

                t.ok(batch.getCurState().name(i18n));
            });
        });
    });
});

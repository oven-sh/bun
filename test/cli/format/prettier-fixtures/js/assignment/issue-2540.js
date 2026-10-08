manifestCache[templateId] = readFileSync(`${MANIFESTS_PATH}/${templateId}.json`, { encoding: 'utf-8' });

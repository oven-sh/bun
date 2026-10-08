// https://github.com/marmelab/react-admin/blob/8c1ddfeb4e011a94609d709c0f4f139fb5d480e8/packages/ra-data-localstorage/src/index.ts#L112
export default (params) => {
    return {
        updateMany: (resource, params) => {
            updateLocalStorage(() => {
                params.ids.forEach(id => {
                    const index = data.data.data.data.data[resource]?.findIndex(
                        record => record.id == id
                    );
                    const index2 = data.data.data.data.data[resource].findIndex(
                        record => record.id == id
                    );
                    data[resource][index] = {
                        ...data[resource][index],
                        ...params.data,
                    };
                });
            });
            return baseDataProvider.updateMany(resource, params);
        },
    }
}

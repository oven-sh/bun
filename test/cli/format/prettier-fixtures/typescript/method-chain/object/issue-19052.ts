export class OpinionsRepositoryService {
  groupBy<Fields extends OpinionField[], TGroupBy extends OpinionField>(
    params: FindAllOpinionsParams,
    groupByField: TGroupBy,
    includeFields = ["_id"] as Fields,
  ) {
    return this.opinionModel
      .aggregate<GroupedOpinions<Fields, TGroupBy>>([
        {
          $match: this.mongodbUtilities.clean(params),
        },
        {
          $group: {
            _id: `$${groupByField}`,
            opinions: {
              $push: includeFields.reduce(
                (acc, field) => ({ ...acc, [field]: `$${field}` }),
                {},
              ),
            },
          },
        },
        { $set: { [groupByField]: "$_id" } },
        { $unset: "_id" },
      ])
      .exec();
  }
}

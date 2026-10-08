export const findByDate: Resolver<void, Recipe[], { date: Date }> =
  (_, { date }, { req } ) => {
    const repo = req.getRepository(Recipe);
    return repo.find({ createDate: date });
  }

export const findByDate: Resolver<void, Recipe[], { date: Date }> =
  (_, { date }, { req } ) => Recipe.find({ createDate: date });

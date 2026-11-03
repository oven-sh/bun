import { Schema } from "effect"

export const UserId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export class User extends Schema.Class<User>("User")({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  age: Schema.Int,
  active: Schema.Boolean,
  score: Schema.Finite,
  role: Schema.Literals(["admin", "member"]),
  city: Schema.String,
  createdAt: Schema.DateTimeUtc,
  visits: Schema.Int,
  passwordHash: Schema.Redacted(Schema.String)
}) {}

export class Profile extends Schema.Class<Profile>("Profile")({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  age: Schema.Int,
  active: Schema.Boolean,
  score: Schema.Finite,
  role: Schema.Literals(["admin", "member"]),
  city: Schema.String,
  createdAt: Schema.DateTimeUtc,
  visits: Schema.Int
}) {}

export class Summary extends Schema.Class<Summary>("Summary")({
  id: UserId,
  name: Schema.String,
  orders: Schema.Int,
  totalCents: Schema.Int
}) {}

export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  { id: UserId },
  { httpApiStatus: 404 }
) {}

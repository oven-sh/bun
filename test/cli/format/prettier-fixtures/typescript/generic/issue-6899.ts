const getUnusedAuthorizationHoldDocuments = async (): Promise<DocumentData[]> => {}

const firestorePersonallyIdentifiablePaths: Array<
  keyof Collections.Users.Entity
> = []

export const SUPPORTED_VEHICLE_TYPES: Array<
  Collections.VehiclesStates.Entity['type']
> = Object.values(Collections.VehiclesStates.Type);

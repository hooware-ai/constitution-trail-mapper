export const proposedPlace: {
  label: string;
  latitude: number;
  longitude: number;
};
export function makeProposed(options?: { granted?: boolean }): {
  manifest: any;
  input: any;
};

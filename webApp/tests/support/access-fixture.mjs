// SYNTHETIC ordinary-road access for the county fixture (tests/support/county-fixture.mjs): one TIGER-style base road far
// from everything, and an endpoint-local service road that is the ONLY way from a cul-de-sac start to the west end of the
// west trail. Self-authored geometry; it is not road data and proves nothing about any real extract.
//
//   start (40.4975, -89.0), exactly on the road  --service road-->  (40.4975, -88.99)  -->  (40.5, -88.99) = west trail end
//
// Without the service road tile the cul-de-sac is off the network (no navigable route); with it, the access is routed.
export const accessPlaces = {
  start: { label: "Synthetic cul-de-sac", latitude: 40.4975, longitude: -89.0 },
  end: { label: "Synthetic west end", latitude: 40.5, longitude: -88.99 },
};

const road = (id, name, ...points) => ({
  id,
  name,
  mtfcc: "S1400",
  paths: [points],
});

export function makeAccessExtract() {
  return {
    job: "Synthetic access roads (test fixture, not road data)",
    layers: [
      {
        id: "tiger",
        name: "Synthetic base roads",
        features: [
          road(
            "tiger:far",
            "Synthetic far road",
            [-88.93, 40.54],
            [-88.92, 40.54],
          ),
        ],
      },
      {
        id: "osm-service",
        name: "Synthetic service roads",
        features: [
          road(
            "osm:service:1",
            "Synthetic service road",
            [-89.0, 40.4975],
            [-88.99, 40.4975],
            [-88.99, 40.5],
          ),
          // A road in a distant cell no journey here touches: proves tiles are not all downloaded.
          road(
            "osm:service:far",
            "Synthetic distant service road",
            [-88.5, 40.3],
            [-88.499, 40.3],
          ),
        ],
      },
    ],
  };
}

/**
 * Built-in demo routes for the SimulatedProvider. The route is the REAL M1
 * westbound carriageway traced from OpenStreetMap (same extraction as the
 * hazard centerline in server/data/hazards.json, clipped wider): ~5 km of
 * genuine motorway lead-in before the construction-zone entry near Tata and
 * ~3 km of overrun past the exit toward Concó, so the simulated car is on the
 * road for the whole run — not just inside the hazard segment.
 * GeoJSON order: [lon, lat]; points listed in DRIVE order (Budapest → Győr).
 */

/** Route (a): toward Győr, through the construction zone, ~5 km lead-in. */
export const ROUTE_TOWARD_GYOR: [number, number][] = [
  [18.38498, 47.60077],
  [18.37802, 47.60368],
  [18.33833, 47.61849],
  [18.32699, 47.62212],
  [18.31802, 47.62407],
  [18.30824, 47.62533],
  [18.29843, 47.62577],
  [18.28415, 47.62546],
  [18.27837, 47.62555],
  [18.27239, 47.6261],
  [18.26718, 47.62708],
  [18.2592, 47.62929],
  [18.24112, 47.63524],
  [18.22657, 47.63923],
  [18.21939, 47.6417],
  [18.21467, 47.64366],
  [18.20705, 47.6473],
  [18.18971, 47.65678],
  [18.18606, 47.65836],
  [18.18185, 47.65977],
  [18.17528, 47.6612],
  [18.15955, 47.66312],
  [18.14978, 47.66479],
  [18.13943, 47.66716],
  [18.12711, 47.6706],
  [18.11957, 47.67244],
  [18.11359, 47.67352],
  [18.10612, 47.67441],
];

/** Route (b): the same corridor reversed (opposite carriageway — stays IDLE). */
export const ROUTE_TOWARD_BUDAPEST: [number, number][] = [...ROUTE_TOWARD_GYOR].reverse();

// Lat/lon ↔ plan-space projector for the Kunitachi city baker.
//
// Plan space contract (shared with src/cityproto/geo.js):
//   u = east(+) / west(−),  v = south(+) / north(−),  apex (station) = (0,0).
// A small equirectangular projection around the station origin maps metres to
// plan units (metersPerUnit), with an optional rotation θ so the JR Chuo line
// (which runs ≈ WNW–ESE) can be levelled onto the horizontal u-axis.
const M_PER_DEG_LAT = 110540;

export function makeProjector({ origin, metersPerUnit, thetaDeg = 0 }) {
  const lat0 = origin.lat, lon0 = origin.lon;
  const mPerLon = M_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180);
  const th = thetaDeg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  return {
    metersPerUnit, origin, thetaDeg,
    toPlan(lat, lon) {
      const xe = (lon - lon0) * mPerLon;          // east metres
      const xs = (lat0 - lat) * M_PER_DEG_LAT;    // south metres (north → negative)
      const xr = c * xe - s * xs, sr = s * xe + c * xs; // rotate to align chuo horizontal
      return { u: xr / metersPerUnit, v: sr / metersPerUnit };
    },
    toLatLon(u, v) {
      const xr = u * metersPerUnit, sr = v * metersPerUnit;
      const xe = c * xr + s * sr, xs = -s * xr + c * sr;
      return { lat: lat0 - xs / M_PER_DEG_LAT, lon: lon0 + xe / mPerLon };
    },
  };
}

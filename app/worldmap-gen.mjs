import fs from 'fs';
import * as topo from 'topojson-client';
import * as simp from 'topojson-simplify';
const r = v => Math.round(v * 10) / 10;
function pathOf(geom, close) {
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.type === 'MultiPolygon' ? geom.coordinates.flat()
    : geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
  let d = '';
  for (const ring of rings) {
    let prev = null, seg = '', last = null;
    for (const [lon0, lat] of ring) {
      // Continuous longitudes: a ring that crosses the date line is not drawn
      // back across the whole map (the page draws copies at ±360°).
      let lon = lon0;
      if (last !== null) { while (lon - last > 180) lon -= 360; while (last - lon > 180) lon += 360; }
      last = lon;
      const x = r(lon + 180), y = r(90 - lat);
      const pt = x + ' ' + y;
      if (pt === prev) continue;
      seg += (seg ? 'L' : 'M') + pt; prev = pt;
    }
    if (seg.split('L').length > 2) d += seg + (close ? 'Z' : '');
  }
  return d;
}
let land = JSON.parse(fs.readFileSync('node_modules/world-atlas/land-50m.json'));
land = simp.simplify(simp.presimplify(land), 0.03);
let countries = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-50m.json'));
countries = simp.simplify(simp.presimplify(countries), 0.03);
const landGeom = topo.feature(land, land.objects.land);
const landD = landGeom.features.map(f => pathOf(f.geometry, true)).join('');
const borders = topo.mesh(countries, countries.objects.countries, (a, b) => a !== b);
const bordersD = pathOf(borders, false);
const out = `'use strict';
/* The world, for the disaster map: land and country borders from Natural
   Earth (public domain), 1:50m simplified, via world-atlas (ISC). Equirectangular, in a
   360 × 180 box: x = longitude + 180, y = 90 − latitude, to 0.1°. Generated,
   not hand-edited. */
const WorldMap = {
  land: ${JSON.stringify(landD)},
  borders: ${JSON.stringify(bordersD)}
};
`;
fs.writeFileSync('/root/temporal-live/source/worldmap.js', out);
console.log((out.length/1024).toFixed(0)+' KB');

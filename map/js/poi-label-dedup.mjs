import { normalizeSearch } from "./place-search.mjs";

const nameFields = ["name", "name:zh-Hans", "name:zh", "name:en"];
const validCoordinates = (value) => Array.isArray(value) && value.length >= 2
  && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
  && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;

function distance(a, b) {
  const dx = (a[0] - b[0]) * Math.cos(b[1] * Math.PI / 180);
  return Math.hypot(dx, a[1] - b[1]) * 111195;
}

export function matchingPoiIds(features, places) {
  const byName = new Map();
  for (const place of places) {
    const name = normalizeSearch(place.title);
    if (!name || !validCoordinates(place.coordinates)) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(place.coordinates);
  }
  const matched = new Set();
  for (const feature of features) {
    const id = feature.id;
    if (!(typeof id === "number" && Number.isSafeInteger(id) && id >= 0)
      && !(typeof id === "string" && id.trim())) continue;
    if (feature.geometry?.type !== "Point" || !validCoordinates(feature.geometry.coordinates)) continue;
    if (nameFields.some((field) => {
      const name = normalizeSearch(feature.properties?.[field]);
      return name && byName.get(name)?.some((coords) => distance(coords, feature.geometry.coordinates) <= 30);
    })) matched.add(String(id));
  }
  return [...matched].sort();
}

export function excludePoiIds(baseFilter, ids) {
  if (!ids.length) return baseFilter;
  const exclude = ["!", ["in", ["to-string", ["id"]], ["literal", ids]]];
  return baseFilter ? ["all", baseFilter, exclude] : exclude;
}

// Read source features, not rendered features: hidden labels must still be
// discoverable on the next update, otherwise their visibility would oscillate.
export function createPoiLabelDedup(map, { defer = setTimeout, cancel = clearTimeout } = {}) {
  let places = [], baseFilter, signature = "", timer = null, disposed = false;

  function refresh() {
    timer = null;
    if (disposed || map.isMoving() || !map.getLayer("pois") || !map.getSource("protomaps")) return;
    let features;
    try { features = map.querySourceFeatures("protomaps", { sourceLayer: "pois" }); }
    catch { return; } // A style/source may still be loading; idle will retry.
    const ids = matchingPoiIds(features, places);
    const next = JSON.stringify(ids);
    if (next === signature) return;
    map.setFilter("pois", excludePoiIds(baseFilter, ids));
    signature = next;
  }

  function schedule() {
    if (!disposed && timer === null) timer = defer(refresh, 80);
  }

  function reset() {
    if (timer !== null) cancel(timer);
    timer = null;
    baseFilter = map.getFilter("pois") ?? null;
    signature = JSON.stringify([]);
    schedule();
  }

  // idle includes completion of newly loaded tiles, without scanning each frame.
  map.on("idle", schedule);
  map.on("moveend", schedule);
  map.on("style.load", reset);
  reset();
  return {
    update(nextPlaces) { places = nextPlaces; schedule(); },
    destroy() {
      disposed = true;
      if (timer !== null) cancel(timer);
      map.off("idle", schedule);
      map.off("moveend", schedule);
      map.off("style.load", reset);
      if (map.getLayer("pois")) map.setFilter("pois", baseFilter);
    }
  };
}

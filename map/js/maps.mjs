export const MAPS = Object.freeze({
  shanghai: Object.freeze({
    id: "shanghai", label: "上海", tile: "tiles/shanghai.pmtiles",
    center: [121.4737, 31.2304], zoom: 10.7, minZoom: 8.5,
    bounds: [[120.65, 30.55], [122.25, 31.95]]
  }),
  beijing: Object.freeze({
    id: "beijing", label: "北京", tile: "tiles/beijing.pmtiles",
    center: [116.4074, 39.9042], zoom: 9.7, minZoom: 8,
    bounds: [[115.75, 39.40], [117.30, 40.55]]
  })
});

export function normalizeMapId(value) {
  return Object.hasOwn(MAPS, value) ? value : "shanghai";
}

export function mapIdFromLocation(locationValue = location) {
  return normalizeMapId(new URL(locationValue.href).searchParams.get("city"));
}

export function urlForMap(mapId, locationValue = location) {
  const url = new URL(locationValue.href);
  if (mapId === "shanghai") url.searchParams.delete("city");
  else url.searchParams.set("city", normalizeMapId(mapId));
  return `${url.pathname}${url.search}${url.hash}`;
}

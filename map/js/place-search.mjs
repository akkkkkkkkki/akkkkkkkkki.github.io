import { MAPS } from "./maps.mjs";

const indexes = new Map();
export const normalizeSearch = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

export async function loadPoiIndex(mapId, fetchImpl = fetch) {
  if (!MAPS[mapId]) throw new Error("不支持的城市");
  if (!indexes.has(mapId)) {
    const pending = (async () => {
      const response = await fetchImpl(new URL(`../data/poi-${mapId}.json`, import.meta.url));
      if (!response.ok) throw new Error("搜索列表加载失败，请重试或在地图上选点");
      const data = await response.json();
      if (data.mapId !== mapId || data.version !== 1 || !Array.isArray(data.points)) throw new Error("搜索列表格式不正确");
      return data.points.map(([title, lng, lat, category, aliases]) => ({
        title, coordinates: [lng, lat], category,
        searchName: normalizeSearch(title), searchAliases: normalizeSearch(aliases)
      }));
    })().catch((error) => { indexes.delete(mapId); throw error; });
    indexes.set(mapId, pending);
  }
  return indexes.get(mapId);
}

function distance(a, b) {
  if (!b) return 0;
  const dx = (a[0] - b[0]) * Math.cos(b[1] * Math.PI / 180), dy = a[1] - b[1];
  return Math.hypot(dx, dy) * 111195;
}

function direction(a, b) {
  if (!b || distance(a, b) < 30) return "附近";
  const east = (a[0] - b[0]) * Math.cos(b[1] * Math.PI / 180), north = a[1] - b[1];
  return ["东", "东北", "北", "西北", "西", "西南", "南", "东南"][(Math.round(Math.atan2(north, east) / (Math.PI / 4)) + 8) % 8] + "侧";
}

export function findPlaces(query, index, recorded = [], center, limit = 20) {
  const needle = normalizeSearch(query);
  if (!needle) return [];
  const matches = [];
  for (const place of [...recorded, ...index]) {
    const name = place.searchName || normalizeSearch(place.title);
    const aliases = place.searchAliases || "";
    if (!name.includes(needle) && !aliases.includes(needle)) continue;
    matches.push({ title: place.title, coordinates: place.coordinates, category: place.category, placeId: place.id || null,
      name, score: (name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3), distanceMeters: Math.round(distance(place.coordinates, center)), direction: direction(place.coordinates, center) });
  }
  matches.sort((a, b) => a.score - b.score || Number(Boolean(b.placeId)) - Number(Boolean(a.placeId)) || a.distanceMeters - b.distanceMeters);
  const results = [];
  for (const item of matches) {
    // The same recorded shop should be offered once, as an existing place.
    if (results.some((other) => other.name === item.name && distance(other.coordinates, item.coordinates) < 80)) continue;
    results.push(item);
    if (results.length >= limit) break;
  }
  return results;
}

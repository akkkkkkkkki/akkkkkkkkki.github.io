const CATEGORIES = new Set(["food", "walk"]);
const PLACE_ID = /^place_[a-f0-9]{8,32}$/;
const ENTRY_ID = /^entry_[a-f0-9]{8,32}$/;
const COLLECTION_ID = /^collection_[a-f0-9]{8,32}$/;
const COLOR = /^#[a-f0-9]{6}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function issue(path, message) {
  return { path, message };
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter((tag) => tag && !seen.has(tag) && seen.add(tag));
}

function validPhoto(photo) {
  return photo && typeof photo === "object" &&
    typeof photo.src === "string" && /^media\/(?!.*\.\.)(?!\/)/.test(photo.src) &&
    typeof photo.alt === "string" && photo.alt.trim().length > 0;
}

export function validateData(raw) {
  const errors = [];
  const data = { version: 2, places: [], collections: [] };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { data, errors: [issue("$", "数据根节点必须是对象")] };
  }
  if (raw.version !== 1 && raw.version !== 2) errors.push(issue("version", "只支持 version: 1 或 version: 2"));
  if (!Array.isArray(raw.places)) errors.push(issue("places", "places 必须是数组"));

  const placeIds = new Set();
  for (const [index, place] of (Array.isArray(raw.places) ? raw.places : []).entries()) {
    const path = `places[${index}]`;
    const local = [];
    if (!place || typeof place !== "object") {
      errors.push(issue(path, "地点必须是对象"));
      continue;
    }
    if (!PLACE_ID.test(place.id || "")) local.push("ID 格式错误");
    if (placeIds.has(place.id)) local.push("ID 重复");
    if (typeof place.title !== "string" || !place.title.trim()) local.push("缺少地点名称");
    if (!CATEGORIES.has(place.category)) local.push("分类只能是 food 或 walk");
    if (!Array.isArray(place.coordinates) || place.coordinates.length !== 2 ||
      !Number.isFinite(place.coordinates[0]) || !Number.isFinite(place.coordinates[1]) ||
      Math.abs(place.coordinates[0]) > 180 || Math.abs(place.coordinates[1]) > 90) {
      local.push("坐标必须是合法的 [经度, 纬度]");
    }
    const entries = normalizeEntries(place, path, errors);
    if (!entries.length) local.push("地点至少需要一条访问记录");
    const photos = place.photos == null ? [] : place.photos;
    if (!Array.isArray(photos)) local.push("photos 必须是数组");
    else if (photos.some((photo) => !validPhoto(photo))) local.push("照片必须使用安全的 media/ 相对路径并填写 alt");

    if (local.length) {
      local.forEach((message) => errors.push(issue(path, message)));
      continue;
    }
    placeIds.add(place.id);
    data.places.push({
      id: place.id,
      title: place.title.trim(),
      category: place.category,
      tags: cleanTags(place.tags),
      coordinates: [place.coordinates[0], place.coordinates[1]],
      entries,
      text: entries.at(-1).text,
      photos: photos.map((photo) => ({ src: photo.src, alt: photo.alt.trim() }))
    });
  }

  const collectionIds = new Set();
  if (!Array.isArray(raw.collections)) errors.push(issue("collections", "collections 必须是数组"));
  for (const [index, collection] of (Array.isArray(raw.collections) ? raw.collections : []).entries()) {
    const path = `collections[${index}]`;
    const local = [];
    if (!collection || typeof collection !== "object") {
      errors.push(issue(path, "点集必须是对象"));
      continue;
    }
    if (!COLLECTION_ID.test(collection.id || "")) local.push("ID 格式错误");
    if (collectionIds.has(collection.id)) local.push("ID 重复");
    if (typeof collection.name !== "string" || !collection.name.trim()) local.push("缺少点集名称");
    if (!COLOR.test(collection.color || "")) local.push("颜色必须是六位十六进制值");
    if (!Array.isArray(collection.placeIds)) local.push("placeIds 必须是数组");

    const validIds = Array.isArray(collection.placeIds)
      ? [...new Set(collection.placeIds.filter((id) => placeIds.has(id)))]
      : [];
    const missingCount = Array.isArray(collection.placeIds) ? collection.placeIds.length - validIds.length : 0;
    if (missingCount) errors.push(issue(`${path}.placeIds`, `忽略了 ${missingCount} 个无效或重复地点引用`));
    if (validIds.length < 2) local.push("点集至少需要两个有效地点");
    if (local.length) {
      local.forEach((message) => errors.push(issue(path, message)));
      continue;
    }
    collectionIds.add(collection.id);
    data.collections.push({
      id: collection.id,
      name: collection.name.trim(),
      color: collection.color.toUpperCase(),
      placeIds: validIds
    });
  }

  return { data, errors };
}

function normalizeEntries(place, path, errors) {
  if (!Array.isArray(place.entries)) {
    if (typeof place.text !== "string" || !place.text.trim()) return [];
    return [{ id: `entry_${String(place.id || "").replace(/^place_/, "")}`, text: place.text.trim(), visitedOn: null }];
  }
  const entries = [];
  const ids = new Set();
  place.entries.forEach((entry, index) => {
    const entryPath = `${path}.entries[${index}]`;
    if (!entry || typeof entry !== "object") {
      errors.push(issue(entryPath, "访问记录必须是对象"));
      return;
    }
    if (!ENTRY_ID.test(entry.id || "") || ids.has(entry.id)) {
      errors.push(issue(entryPath, "访问记录 ID 格式错误或重复"));
      return;
    }
    if (typeof entry.text !== "string" || !entry.text.trim()) {
      errors.push(issue(entryPath, "访问记录文字不能为空"));
      return;
    }
    if (entry.visitedOn != null && entry.visitedOn !== "" && (typeof entry.visitedOn !== "string" || !DATE.test(entry.visitedOn))) {
      errors.push(issue(entryPath, "访问日期必须是 YYYY-MM-DD"));
      return;
    }
    ids.add(entry.id);
    entries.push({
      id: entry.id,
      text: entry.text.trim(),
      visitedOn: entry.visitedOn || null,
      ...(typeof entry.createdAt === "string" ? { createdAt: entry.createdAt } : {}),
      ...(typeof entry.updatedAt === "string" ? { updatedAt: entry.updatedAt } : {})
    });
  });
  return entries;
}

export function filterPlaces(places, filters = {}) {
  const categories = filters.categories instanceof Set ? filters.categories : new Set(["food", "walk"]);
  const tags = filters.tags instanceof Set ? filters.tags : new Set();
  return places.filter((place) => categories.has(place.category) && [...tags].every((tag) => place.tags.includes(tag)));
}

export function getTagStats(places) {
  const counts = new Map();
  places.forEach((place) => place.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

function distanceSquared(a, b) {
  const latitudeScale = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const x = (a[0] - b[0]) * latitudeScale;
  const y = a[1] - b[1];
  return x * x + y * y;
}

export function buildCollectionLines(places, collection) {
  const lookup = new Map(places.map((place) => [place.id, place]));
  const nodes = collection.placeIds.map((id) => lookup.get(id)).filter(Boolean);
  if (nodes.length < 2) return { type: "FeatureCollection", features: [] };

  const connected = new Set([0]);
  const features = [];
  while (connected.size < nodes.length) {
    let best = null;
    for (const from of connected) {
      for (let to = 0; to < nodes.length; to += 1) {
        if (connected.has(to)) continue;
        const distance = distanceSquared(nodes[from].coordinates, nodes[to].coordinates);
        if (!best || distance < best.distance) best = { from, to, distance };
      }
    }
    connected.add(best.to);
    features.push({
      type: "Feature",
      properties: { collectionId: collection.id, color: collection.color },
      geometry: { type: "LineString", coordinates: [nodes[best.from].coordinates, nodes[best.to].coordinates] }
    });
  }
  return { type: "FeatureCollection", features };
}

export function makeId(prefix, random = globalThis.crypto) {
  const bytes = new Uint8Array(4);
  random.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function toGeoJSON(places) {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature",
      id: place.id,
      properties: { id: place.id, title: place.title, category: place.category, tags: place.tags.join(" · ") },
      geometry: { type: "Point", coordinates: place.coordinates }
    }))
  };
}

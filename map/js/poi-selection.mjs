const foodKinds = new Set(["restaurant", "fast_food", "cafe", "bar", "pub", "food_court", "bakery", "ice_cream", "supermarket", "convenience"]);

export function poiSelection(feature) {
  if (feature?.geometry?.type !== "Point") return null;
  const coordinates = feature.geometry.coordinates?.slice(0, 2);
  if (coordinates?.length !== 2 || !coordinates.every(Number.isFinite)) return null;
  const properties = feature.properties || {};
  const title = [properties["name:zh-Hans"], properties.name, properties["name:zh"], properties["name:en"]]
    .find((value) => typeof value === "string" && value.trim());
  if (!title) return null;
  return { title: title.trim().slice(0, 80), coordinates, category: foodKinds.has(properties.kind) ? "food" : "walk" };
}

// These editable hints travel with the QR link; coordinates and permissions
// still come from the server-side draft, never from the fragment.
export function withDraftPrefill(url, place) {
  const result = new URL(url);
  result.hash = new URLSearchParams({ title: place.title.trim().slice(0, 80), category: place.category === "walk" ? "walk" : "food" }).toString();
  return result.href;
}

export function readDraftPrefill(hash) {
  const values = new URLSearchParams(hash.replace(/^#/, ""));
  return { title: (values.get("title") || "").trim().slice(0, 80), category: values.get("category") === "walk" ? "walk" : "food" };
}

import { buildCollectionLines, filterPlaces, getTagStats, toGeoJSON, validateData } from "./data-store.mjs";
import { createEditor } from "./editor.mjs";
import { createMapStyle } from "./map-style.mjs";

const $ = (id) => document.getElementById(id);
const state = {
  data: { version: 1, places: [], collections: [] }, errors: [],
  categories: new Set(["food", "walk"]), tags: new Set(), activeCollectionId: null,
  selectedId: null, theme: safePreference("map-theme", "warm"), view: safePreference("map-view", "map")
};
let map;
let popup;
let editor;
let toastTimer;

boot().catch(showFatal);

async function boot() {
  if (!globalThis.maplibregl || !globalThis.pmtiles || !globalThis.basemaps) {
    throw new Error("地图运行库没有正确加载");
  }

  const response = await fetch("data/map-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`地点数据加载失败（${response.status}）`);
  const result = validateData(await response.json());
  state.data = result.data;
  state.errors = result.errors;

  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  const tileUrl = new URL("tiles/shanghai.pmtiles", location.href).href;

  applyTheme(false);
  map = new maplibregl.Map({
    container: "map",
    style: createMapStyle(state.theme, tileUrl),
    center: readMapPosition()?.center || [121.4737, 31.2304],
    zoom: readMapPosition()?.zoom || 10.7,
    minZoom: 8.5,
    maxZoom: 18,
    maxBounds: [[120.65, 30.55], [122.25, 31.95]],
    attributionControl: false,
    localIdeographFontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
  });

  map.on("error", (event) => {
    if (!$('loading').hidden) showFatal(event.error || new Error("地图文件加载失败"));
    else console.warn("Map resource error", event.error);
  });
  await once(map, "style.load");
  addBusinessLayers();
  bindMapEvents();
  bindUI();
  renderAll();
  setView(state.view, false);

  if (new URLSearchParams(location.search).get("edit") === "1") {
    editor = createEditor({
      map,
      getData: () => state.data,
      setData: replaceData,
      getSelectedId: () => state.selectedId,
      showToast
    });
  }

  $("loading").hidden = true;
}

function once(target, eventName) {
  return new Promise((resolve) => target.once(eventName, resolve));
}

function addBusinessLayers() {
  if (!map.getSource("collection-lines")) {
    map.addSource("collection-lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "collection-lines", type: "line", source: "collection-lines", paint: {
      "line-color": ["coalesce", ["get", "color"], "#A56E62"], "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 16, 3],
      "line-opacity": .66, "line-dasharray": [2, 1.7]
    } });
  }
  if (!map.getSource("places")) {
    map.addSource("places", { type: "geojson", data: toGeoJSON([]), cluster: true, clusterMaxZoom: 13, clusterRadius: 46 });
    map.addLayer({ id: "place-clusters", type: "circle", source: "places", filter: ["has", "point_count"], paint: {
      "circle-color": state.theme === "night" ? "#D6B96E" : "#746553", "circle-radius": ["step", ["get", "point_count"], 16, 20, 20, 80, 25],
      "circle-stroke-width": 3, "circle-stroke-color": state.theme === "night" ? "#213238" : "#FFF9EF", "circle-opacity": .92
    } });
    map.addLayer({ id: "place-cluster-count", type: "symbol", source: "places", filter: ["has", "point_count"], layout: {
      "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 11
    }, paint: { "text-color": state.theme === "night" ? "#1B2C31" : "#FFFFFF" } });
    map.addLayer({ id: "place-points", type: "circle", source: "places", filter: ["!", ["has", "point_count"]], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5.5, 15, 8],
      "circle-color": ["match", ["get", "category"], "food", "#D66D48", "#43866E"],
      "circle-stroke-width": 3, "circle-stroke-color": state.theme === "night" ? "#22343A" : "#FFF9EF"
    } });
    map.addLayer({ id: "place-selected", type: "circle", source: "places", filter: ["==", ["get", "id"], ""], paint: {
      "circle-radius": 13, "circle-color": "transparent", "circle-stroke-width": 2, "circle-stroke-color": state.theme === "night" ? "#F0D689" : "#55483B"
    } });
  }
}

function bindMapEvents() {
  map.on("click", "place-clusters", async (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const zoom = await map.getSource("places").getClusterExpansionZoom(feature.properties.cluster_id);
    map.easeTo({ center: feature.geometry.coordinates, zoom, duration: reducedMotion() ? 0 : 520 });
  });
  map.on("click", "place-points", (event) => {
    const feature = event.features?.[0];
    if (feature) selectPlace(feature.properties.id, true);
  });
  ["place-clusters", "place-points"].forEach((layer) => {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  });
  map.on("click", (event) => {
    if (editor?.handleMapClick(event.lngLat)) return;
    if (map.queryRenderedFeatures(event.point, { layers: ["place-clusters", "place-points"] }).length === 0) selectPlace(null);
  });
  map.on("moveend", () => writeMapPosition());
}

function bindUI() {
  $("view-button").addEventListener("click", () => setView(state.view === "map" ? "journal" : "map"));
  $("theme-button").addEventListener("click", () => {
    state.theme = state.theme === "warm" ? "night" : "warm";
    applyTheme();
    map.once("style.load", () => { addBusinessLayers(); renderAll(); });
    map.setStyle(createMapStyle(state.theme, new URL("tiles/shanghai.pmtiles", location.href).href));
  });
  bindPanelButton("filter-button", "filter-panel");
  bindPanelButton("collection-button", "collections-panel");
  bindPanelButton("info-button", "info-panel");
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closePanel(button.dataset.close)));
  $("journal-close-button").addEventListener("click", () => setView("map"));
  $("details-close-button").addEventListener("click", () => closeDetails());
  $("clear-filter-button").addEventListener("click", () => {
    state.categories = new Set(["food", "walk"]); state.tags.clear();
    document.querySelectorAll('.category-options input').forEach((input) => { input.checked = true; });
    renderAll();
  });
  document.querySelectorAll('.category-options input').forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.categories.add(input.value); else state.categories.delete(input.value);
    renderAll();
  }));
  $("retry-button").addEventListener("click", () => location.reload());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeDetails(); closePanels(); }
  });
}

function bindPanelButton(buttonId, panelId) {
  $(buttonId).addEventListener("click", () => {
    const willOpen = $(panelId).hidden;
    closePanels();
    $(panelId).hidden = !willOpen;
    $(buttonId).setAttribute("aria-expanded", String(willOpen));
  });
}

function closePanels() {
  ["filter-panel", "collections-panel", "info-panel"].forEach((id) => closePanel(id));
}

function closePanel(id) {
  $(id).hidden = true;
  const button = { "filter-panel": "filter-button", "collections-panel": "collection-button", "info-panel": "info-button" }[id];
  if (button) $(button).setAttribute("aria-expanded", "false");
}

function currentPlaces() {
  let places = filterPlaces(state.data.places, state);
  if (state.activeCollectionId) {
    const collection = state.data.collections.find((item) => item.id === state.activeCollectionId);
    const ids = new Set(collection?.placeIds || []);
    places = places.filter((place) => ids.has(place.id));
  }
  return places;
}

function renderAll() {
  if (!map?.getSource("places")) return;
  const places = currentPlaces();
  map.getSource("places").setData(toGeoJSON(places));
  renderTags();
  renderCollections();
  renderJournal(places);
  renderCollectionLines();
  renderErrors();
  $("result-count").textContent = `${places.length} / ${state.data.places.length} 个地点`;
  $("filter-dot").hidden = state.categories.size === 2 && state.tags.size === 0;
  if (state.selectedId && !places.some((place) => place.id === state.selectedId)) selectPlace(null);
  editor?.refresh();
}

function renderTags() {
  $("tag-cloud").innerHTML = "";
  const stats = getTagStats(state.data.places);
  const max = Math.max(...stats.map((item) => item.count), 1);
  stats.forEach(({ tag, count }) => {
    const button = document.createElement("button");
    button.className = `tag-chip${state.tags.has(tag) ? " is-active" : ""}`;
    button.style.fontSize = `${11 + (count / max) * 2}px`;
    button.setAttribute("aria-pressed", String(state.tags.has(tag)));
    button.append(document.createTextNode(tag));
    const small = document.createElement("small"); small.textContent = count; button.append(small);
    button.addEventListener("click", () => { state.tags.has(tag) ? state.tags.delete(tag) : state.tags.add(tag); renderAll(); });
    $("tag-cloud").append(button);
  });
}

function renderCollections() {
  $("collection-list").innerHTML = "";
  const all = document.createElement("button");
  all.className = `choice-button${state.activeCollectionId ? "" : " is-active"}`;
  all.textContent = "显示全部地点";
  all.addEventListener("click", () => { state.activeCollectionId = null; renderAll(); closePanel("collections-panel"); });
  $("collection-list").append(all);
  state.data.collections.forEach((collection) => {
    const button = document.createElement("button");
    button.className = `choice-button${state.activeCollectionId === collection.id ? " is-active" : ""}`;
    const dot = document.createElement("span"); dot.className = "choice-color"; dot.style.setProperty("--choice-color", collection.color);
    button.append(dot, document.createTextNode(`${collection.name} · ${collection.placeIds.length}`));
    button.addEventListener("click", () => { state.activeCollectionId = state.activeCollectionId === collection.id ? null : collection.id; renderAll(); closePanel("collections-panel"); });
    $("collection-list").append(button);
  });
  $("collection-button").classList.toggle("is-active", Boolean(state.activeCollectionId));
}

function renderCollectionLines() {
  const source = map.getSource("collection-lines");
  const collection = state.data.collections.find((item) => item.id === state.activeCollectionId);
  source?.setData(collection ? buildCollectionLines(state.data.places, collection) : { type: "FeatureCollection", features: [] });
}

function renderJournal(places) {
  $("journal-count").textContent = `${places.length} 个地点`;
  $("journal-list").innerHTML = "";
  places.forEach((place) => {
    const button = document.createElement("button");
    button.className = `journal-item${state.selectedId === place.id ? " is-active" : ""}`;
    button.dataset.id = place.id;
    const title = document.createElement("h3"); title.textContent = place.title;
    const tags = createMiniTags(place);
    const text = document.createElement("p"); text.textContent = place.text;
    button.append(title, tags, text);
    button.addEventListener("click", () => selectPlace(place.id, true));
    $("journal-list").append(button);
  });
}

function selectPlace(id, move = false) {
  state.selectedId = id;
  editor?.onSelection(id);
  if (map.getLayer("place-selected")) map.setFilter("place-selected", ["==", ["get", "id"], id || ""]);
  popup?.remove(); popup = null;
  document.querySelectorAll(".journal-item").forEach((item) => item.classList.toggle("is-active", item.dataset.id === id));
  if (!id) { closeDetails(); return; }
  const place = state.data.places.find((item) => item.id === id);
  if (!place) return;
  if (move) map.easeTo({ center: place.coordinates, zoom: Math.max(map.getZoom(), 14), duration: reducedMotion() ? 0 : 520, offset: state.view === "journal" && innerWidth > 760 ? [-150, 0] : [0, 0] });
  const content = document.createElement("button");
  content.className = "place-card-button";
  const expand = document.createElement("span"); expand.className = "card-expand"; expand.textContent = "↗";
  const title = document.createElement("h3"); title.textContent = place.title;
  const tags = createMiniTags(place);
  const text = document.createElement("p"); text.textContent = place.text;
  content.append(expand, title, tags, text);
  content.addEventListener("click", () => openDetails(place));
  popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: "240px", className: "place-popup" })
    .setLngLat(place.coordinates).setDOMContent(content).addTo(map);
}

function createMiniTags(place) {
  const wrap = document.createElement("div"); wrap.className = "mini-tags";
  const category = document.createElement("span");
  category.className = `mini-tag category-${place.category}`; category.textContent = place.category === "food" ? "吃喝" : "散步";
  wrap.append(category);
  place.tags.forEach((tag) => { const chip = document.createElement("span"); chip.className = "mini-tag"; chip.textContent = tag; wrap.append(chip); });
  return wrap;
}

function openDetails(place) {
  const content = $("details-content"); content.innerHTML = "";
  const title = document.createElement("h1"); title.textContent = place.title;
  const tags = createMiniTags(place);
  const text = document.createElement("div"); text.className = "details-text"; text.textContent = place.text;
  content.append(title, tags, text);
  if (place.photos.length) {
    const grid = document.createElement("div"); grid.className = "photo-grid";
    place.photos.forEach((photo) => {
      const image = document.createElement("img"); image.src = photo.src; image.alt = photo.alt; image.loading = "lazy";
      image.addEventListener("error", () => { const fallback = document.createElement("div"); fallback.className = "photo-fallback"; fallback.textContent = photo.alt; image.replaceWith(fallback); });
      grid.append(image);
    });
    content.append(grid);
  }
  $("details-panel").hidden = false;
}

function closeDetails() { $("details-panel").hidden = true; }

function setView(view, persist = true) {
  state.view = view === "journal" ? "journal" : "map";
  const journal = state.view === "journal";
  $("app").classList.toggle("is-journal", journal);
  $("journal-panel").hidden = !journal;
  $("view-button").setAttribute("aria-pressed", String(journal));
  $("view-button").classList.toggle("is-active", !journal);
  if (persist) safeSet("map-view", state.view);
  requestAnimationFrame(() => map?.resize());
}

function applyTheme(persist = true) {
  $("app").dataset.theme = state.theme;
  $("theme-button").classList.toggle("is-active", state.theme === "night");
  document.querySelector('meta[name="theme-color"]').content = state.theme === "night" ? "#17262B" : "#E8E2D6";
  if (persist) safeSet("map-theme", state.theme);
}

function renderErrors() {
  $("error-dot").hidden = state.errors.length === 0;
  const box = $("data-errors");
  box.hidden = state.errors.length === 0;
  box.textContent = state.errors.length ? state.errors.map((error) => `${error.path}：${error.message}`).join("\n") : "";
}

function replaceData(data, errors) {
  state.data = data;
  state.errors = errors;
  state.activeCollectionId = null;
  selectPlace(null);
  renderAll();
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2800);
}

function showFatal(error) {
  console.error(error);
  $("loading").hidden = true;
  $("fatal-error").hidden = false;
  $("fatal-message").textContent = error?.message || "请稍后重试。";
}

function safePreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch {} }
function readMapPosition() {
  try { const value = JSON.parse(localStorage.getItem("map-position")); return value?.center?.length === 2 && Number.isFinite(value.zoom) ? value : null; } catch { return null; }
}
function writeMapPosition() {
  if (!map) return;
  const center = map.getCenter(); safeSet("map-position", JSON.stringify({ center: [center.lng, center.lat], zoom: map.getZoom() }));
}
function reducedMotion() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

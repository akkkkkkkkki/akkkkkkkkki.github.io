import { buildCollectionLines, filterPlaces, getTagStats, toGeoJSON } from "./data-store.mjs";
import { loadMapData } from "./api-client.mjs";
import { createContributor } from "./contributor.mjs";
import { createMapStyle } from "./map-style.mjs";
import { hidePanel, panelIsOpen, showPanel } from "./panel-motion.mjs";
import { MAPS, mapIdFromLocation, normalizeMapId, urlForMap } from "./maps.mjs";

const $ = (id) => document.getElementById(id);
const state = {
  data: { version: 2, places: [], collections: [] }, errors: [],
  categories: new Set(["food", "walk"]), tags: new Set(), activeCollectionId: null,
  selectedId: null, theme: safePreference("map-theme", "warm"), view: safePreference("map-view", "map"),
  mapId: mapIdFromLocation(), switching: false
};
let map;
let popup;
let contributor;
let toastTimer;

boot().catch(showFatal);

async function boot() {
  if (!globalThis.maplibregl || !globalThis.pmtiles || !globalThis.basemaps) {
    throw new Error("地图运行库没有正确加载");
  }

  const result = await loadMapData(state.mapId);
  state.data = result.data;
  state.errors = result.errors;

  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  const config = MAPS[state.mapId];
  const tileUrl = new URL(config.tile, location.href).href;

  applyTheme(false);
  map = new maplibregl.Map({
    container: "map",
    style: createMapStyle(state.theme, tileUrl),
    center: readMapPosition()?.center || config.center,
    zoom: readMapPosition()?.zoom || config.zoom,
    minZoom: config.minZoom,
    maxZoom: 18,
    maxBounds: config.bounds,
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
  contributor = createContributor({
    map,
    showToast,
    closeOtherPanels: () => { closePanels(); closeDetails(); },
    reloadData,
    getMapId: () => state.mapId
  });
  renderAll();
  renderMapSwitch();
  setView(state.view, false);

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
    map.addLayer({ id: "place-labels", type: "symbol", source: "places", filter: ["!", ["has", "point_count"]], layout: {
      "text-field": ["get", "title"], "text-font": ["Noto Sans Regular"], "text-size": 11,
      "text-anchor": "bottom", "text-offset": [0, -1], "text-max-width": 10, "text-padding": 3,
      "text-letter-spacing": .01
    }, paint: {
      "text-color": state.theme === "night" ? "#D8E1DE" : "#554B41",
      "text-halo-color": state.theme === "night" ? "#17282D" : "#FFF9EF",
      "text-halo-width": 1.4, "text-halo-blur": .25
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
  ["place-points", "place-labels"].forEach((layer) => map.on("click", layer, (event) => {
    const feature = event.features?.[0];
    if (feature) selectPlace(feature.properties.id, true);
  }));
  ["place-clusters", "place-points", "place-labels"].forEach((layer) => {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  });
  map.on("click", (event) => {
    if (contributor?.handleMapClick(event.lngLat)) return;
    if (map.queryRenderedFeatures(event.point, { layers: ["place-clusters", "place-points", "place-labels"] }).length === 0) selectPlace(null);
  });
  map.on("moveend", () => writeMapPosition());
}

function bindUI() {
  $("view-button").addEventListener("click", () => setView(state.view === "map" ? "journal" : "map"));
  $("theme-button").addEventListener("click", () => {
    state.theme = state.theme === "warm" ? "night" : "warm";
    applyTheme();
    map.once("style.load", () => { addBusinessLayers(); renderAll(); });
    map.setStyle(createMapStyle(state.theme, tileUrlFor(state.mapId)));
  });
  $("map-switch-button").addEventListener("click", () => {
    const menu = $("map-switch-menu");
    menu.hidden = !menu.hidden;
    $("map-switch-button").setAttribute("aria-expanded", String(!menu.hidden));
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
    if (event.key === "Escape") { closeDetails(); closePanels(); closeMapSwitch(); }
  });
  addEventListener("popstate", () => switchMap(mapIdFromLocation(), { updateUrl: false }));
}

function renderMapSwitch() {
  const menu = $("map-switch-menu");
  menu.replaceChildren();
  Object.values(MAPS).forEach((config) => {
    const button = document.createElement("button");
    button.className = `map-switch-option${config.id === state.mapId ? " is-active" : ""}`;
    button.type = "button";
    button.textContent = config.label;
    button.setAttribute("aria-current", config.id === state.mapId ? "true" : "false");
    button.addEventListener("click", () => switchMap(config.id));
    menu.append(button);
  });
  $("map").setAttribute("aria-label", `${MAPS[state.mapId].label}地点地图`);
}

function closeMapSwitch() {
  $("map-switch-menu").hidden = true;
  $("map-switch-button").setAttribute("aria-expanded", "false");
}

async function switchMap(nextId, { updateUrl = true } = {}) {
  nextId = normalizeMapId(nextId);
  closeMapSwitch();
  if (nextId === state.mapId || state.switching) return;
  state.switching = true;
  writeMapPosition();
  $("map").classList.add("is-switching");
  try {
    const result = await loadMapData(nextId);
    state.mapId = nextId;
    state.categories = new Set(["food", "walk"]);
    state.tags.clear();
    state.activeCollectionId = null;
    state.selectedId = null;
    closeDetails();
    closePanels();
    const config = MAPS[nextId];
    map.setMinZoom(config.minZoom);
    map.setMaxBounds(config.bounds);
    const loaded = once(map, "style.load");
    map.setStyle(createMapStyle(state.theme, tileUrlFor(nextId)));
    await loaded;
    addBusinessLayers();
    const saved = readMapPosition();
    map.jumpTo({ center: saved?.center || config.center, zoom: saved?.zoom || config.zoom });
    replaceData(result.data, result.errors);
    renderMapSwitch();
    if (updateUrl) history.pushState({ city: nextId }, "", urlForMap(nextId));
  } catch (error) {
    showToast(error.message || "地图切换失败");
  } finally {
    state.switching = false;
    $("map").classList.remove("is-switching");
  }
}

function tileUrlFor(mapId) {
  return new URL(MAPS[mapId].tile, location.href).href;
}

function bindPanelButton(buttonId, panelId) {
  $(buttonId).addEventListener("click", () => {
    const willOpen = !panelIsOpen($(panelId));
    closePanels();
    if (willOpen) showPanel($(panelId));
    $(buttonId).setAttribute("aria-expanded", String(willOpen));
  });
}

function closePanels() {
  ["filter-panel", "collections-panel", "info-panel"].forEach((id) => closePanel(id));
  contributor?.close();
}

function closePanel(id) {
  hidePanel($(id));
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
  all.textContent = "Show all";
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
  const entries = document.createElement("div"); entries.className = "visit-entries";
  place.entries.forEach((entry) => {
    const wrap = document.createElement("section"); wrap.className = "visit-entry";
    if (entry.visitedOn) {
      const date = document.createElement("p"); date.className = "visit-entry-date"; date.textContent = entry.visitedOn;
      wrap.append(date);
    }
    const text = document.createElement("p"); text.className = "visit-entry-text"; text.textContent = entry.text;
    wrap.append(text);
    if (entry.contributorName) {
      const from = document.createElement("p"); from.className = "visit-entry-from"; from.textContent = `from: ${entry.contributorName}`;
      wrap.append(from);
    }
    entries.append(wrap);
  });
  const addEntry = document.createElement("button");
  addEntry.className = "details-add-entry";
  addEntry.type = "button";
  addEntry.textContent = "+";
  addEntry.setAttribute("aria-label", "为这个地点新增记录");
  addEntry.title = "为这个地点新增记录";
  addEntry.addEventListener("click", () => contributor?.openForPlace(place));
  content.append(title, tags, entries, addEntry);
  if (place.photos.length) {
    const grid = document.createElement("div"); grid.className = "photo-grid";
    place.photos.forEach((photo) => {
      const image = document.createElement("img"); image.src = photo.src; image.alt = photo.alt; image.loading = "lazy";
      image.addEventListener("error", () => { const fallback = document.createElement("div"); fallback.className = "photo-fallback"; fallback.textContent = photo.alt; image.replaceWith(fallback); });
      grid.append(image);
    });
    content.append(grid);
  }
  showPanel($("details-panel"));
}

function closeDetails() { hidePanel($("details-panel")); }

function setView(view, persist = true) {
  state.view = view === "journal" ? "journal" : "map";
  const journal = state.view === "journal";
  $("app").classList.toggle("is-journal", journal);
  if (journal) showPanel($("journal-panel")); else hidePanel($("journal-panel"));
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

async function reloadData() {
  const result = await loadMapData(state.mapId);
  replaceData(result.data, result.errors);
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
  try { const value = JSON.parse(localStorage.getItem(`map-position:${state.mapId}`)); return value?.center?.length === 2 && Number.isFinite(value.zoom) ? value : null; } catch { return null; }
}
function writeMapPosition() {
  if (!map) return;
  const center = map.getCenter(); safeSet(`map-position:${state.mapId}`, JSON.stringify({ center: [center.lng, center.lat], zoom: map.getZoom() }));
}
function reducedMotion() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

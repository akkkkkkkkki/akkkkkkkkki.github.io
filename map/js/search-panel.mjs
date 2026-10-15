import { hidePanel, panelIsOpen, showPanel } from "./panel-motion.mjs";
import { findPlaces, loadPoiIndex } from "./place-search.mjs";
import { MAPS } from "./maps.mjs";

export function createSearchPanel({ map, getMapId, getPlaces, closeOtherPanels, onSelect }) {
  const $ = (id) => document.getElementById(id);
  const panel = $("search-panel"), input = $("map-search-input"), results = $("map-search-results"), status = $("map-search-status");
  let generation = 0, timer, intent = "browse", lastMapId = null;
  function close() {
    generation++; clearTimeout(timer);
    hidePanel(panel); $("search-button").setAttribute("aria-expanded", "false");
  }
  function open(nextIntent = "browse") {
    closeOtherPanels(); intent = nextIntent;
    const mapId = getMapId();
    if (mapId !== lastMapId) { input.value = ""; results.replaceChildren(); }
    lastMapId = mapId;
    input.placeholder = `Search ${MAPS[mapId].label}`;
    status.textContent = "搜索底图店铺和已记录地点";
    showPanel(panel); $("search-button").setAttribute("aria-expanded", "true"); input.focus();
    if (input.value.trim()) void run();
  }
  function render(items) {
    results.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button"); button.type = "button"; button.className = "map-search-result";
      const title = document.createElement("strong"); title.textContent = item.title;
      const detail = document.createElement("small");
      detail.textContent = `${item.placeId ? "已记录 · " : ""}${item.direction} · ${item.distanceMeters < 1000 ? `${item.distanceMeters} m` : `${(item.distanceMeters / 1000).toFixed(1)} km`}`;
      button.append(title, detail);
      button.addEventListener("click", () => { const currentIntent = intent; close(); onSelect(item, currentIntent); });
      results.append(button);
    }
  }
  async function run() {
    const current = ++generation, query = input.value.trim(), mapId = getMapId();
    if (!query) { render([]); status.textContent = "搜索底图店铺和已记录地点"; return; }
    const center = map.getCenter().toArray();
    const saved = findPlaces(query, [], getPlaces(), center);
    render(saved); status.textContent = "Searching…";
    try {
      const index = await loadPoiIndex(mapId);
      if (current !== generation || mapId !== getMapId()) return;
      const matches = findPlaces(query, index, getPlaces(), center);
      render(matches);
      status.textContent = matches.length ? "距离以当前地图中心计算" : "没有找到，可换个名称或在地图上选点";
    } catch (error) {
      if (current === generation) status.textContent = saved.length ? "已显示记录中的地点；底图搜索加载失败，可重试" : error.message;
    }
  }
  $("search-button").addEventListener("click", () => panelIsOpen(panel) ? close() : open());
  $("search-close-button").addEventListener("click", close);
  $("map-search-form").addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(timer); void run(); });
  input.addEventListener("input", () => { generation++; clearTimeout(timer); timer = setTimeout(run, 200); });
  return { open, close };
}

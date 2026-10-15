import { deleteDraftPhoto, draftPhotoUrl, getMobileDraft, isNetworkError, markMobileDraftOpened, reverseLocation, searchPlaces, submitMobileDraft, uploadDraftPhoto } from "../js/api-client.mjs?v=20260817-2";
import { MAPS } from "../js/maps.mjs";
import { createMapStyle } from "../js/map-style.mjs?v=20261012-1";
import { poiSelection, readDraftPrefill } from "../js/poi-selection.mjs";
import { photoForm, processPhoto } from "../js/photo-processing.mjs";
import { findPlaces, loadPoiIndex } from "../js/place-search.mjs";

const $ = (id) => document.getElementById(id);
const token = new URL(location.href).searchParams.get("draft") || "";
let draft;
let coordinates;
let miniMap;
let marker;
let photos = [];
let toastTimer;

boot().catch(showFatal);

async function boot() {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("链接不存在");
  const result = await getMobileDraft(token);
  draft = result.draft;
  if (draft.status === "submitted") return showComplete(draft.result?.entryId ? "已发布" : "已提交", draft.result?.entryId ? "这条记录已经出现在地图上。" : "投稿已进入待审核。");
  if (draft.status === "cancelled") throw new Error("这次填写已经结束");
  if (draft.status === "expired") throw new Error("链接已过期，请在电脑上重新生成");
  const opened = await markMobileDraftOpened(token);
  // Opening locks desktop location edits; use the coordinates returned after that lock.
  if (opened.draft) draft = { ...opened.draft, photos: result.draft.photos };
  coordinates = draft.coordinates;
  photos = draft.photos || [];
  $("mobile-loading").hidden = true; $("mobile-form").hidden = false;
  if (draft.type === "new_entry") {
    $("new-place-mobile-fields").hidden = true;
    $("change-location").hidden = true;
    $("mobile-title").required = false;
    $("mobile-location-value").textContent = draft.placeTitle;
  } else {
    const prefill = readDraftPrefill(location.hash);
    $("mobile-title").value = prefill.title;
    $("mobile-category").value = prefill.category;
    $("mobile-location-value").textContent = formatCoordinates(coordinates);
  }
  restoreLocal();
  renderPhotos();
  bindUI();
}

function bindUI() {
  $("change-location").addEventListener("click", () => { $("location-methods").hidden = !$("location-methods").hidden; });
  document.querySelectorAll("[data-method]").forEach((button) => button.addEventListener("click", () => chooseMethod(button.dataset.method, button)));
  $("place-search-button").addEventListener("click", runSearch);
  $("place-search-input").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runSearch(); } });
  $("mobile-photo-input").addEventListener("change", onFiles);
  $("mobile-form").addEventListener("input", saveLocal);
  $("mobile-form").addEventListener("submit", onSubmit);
}

async function chooseMethod(method, button) {
  document.querySelectorAll("[data-method]").forEach((item) => item.classList.toggle("is-active", item === button));
  $("location-search").hidden = method !== "search"; $("search-results").hidden = true;
  if (method === "locate") await locate();
  if (method === "manual") await showManualMap();
}

async function locate() {
  if (!navigator.geolocation) return showToast("这个浏览器不支持定位");
  navigator.geolocation.getCurrentPosition(async (position) => {
    coordinates = [position.coords.longitude, position.coords.latitude];
    try { $("mobile-location-value").textContent = (await reverseLocation(draft.mapId, coordinates)).address; }
    catch { $("mobile-location-value").textContent = formatCoordinates(coordinates); }
    await showManualMap(); miniMap.jumpTo({ center: coordinates, zoom: 16 }); marker.setLngLat(coordinates); saveLocal();
  }, (error) => showToast(error.code === 1 ? "定位权限没有开启，可使用搜索或手动选点" : "暂时无法定位，请重试"), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}

async function runSearch() {
  const keywords = $("place-search-input").value.trim(); if (!keywords) return;
  const button = $("place-search-button"); button.disabled = true;
  try {
    let result;
    try {
      const local = findPlaces(keywords, await loadPoiIndex(draft.mapId), [], coordinates);
      result = { results: local.map((place) => ({ ...place, name: place.title, address: "" })) };
    } catch { /* The existing online search remains a fallback if the index cannot load. */ }
    if (!result?.results.length) result = await searchPlaces(draft.mapId, keywords, coordinates);
    const box = $("search-results"); box.replaceChildren(); box.hidden = false;
    if (!result.results.length) box.textContent = "没有找到，可以使用手动选点";
    result.results.forEach((place) => {
      const item = document.createElement("button"); item.type = "button"; item.className = "search-result";
      const title = document.createElement("strong"); title.textContent = place.name;
      const address = document.createElement("small"); address.textContent = [place.address, formatDistance(place.distanceMeters)].filter(Boolean).join(" · ");
      item.append(title, address); item.addEventListener("click", async () => {
        coordinates = place.coordinates; $("mobile-title").value ||= place.name; $("mobile-location-value").textContent = `${place.name} · ${place.address || ""}`;
        box.hidden = true; await showManualMap(); miniMap.jumpTo({ center: coordinates, zoom: 16 }); marker.setLngLat(coordinates); saveLocal();
      }); box.append(item);
    });
  } catch (error) { showToast(error.message); } finally { button.disabled = false; }
}

async function showManualMap() {
  $("mobile-mini-map").hidden = false;
  if (miniMap) return;
  const protocol = new pmtiles.Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile);
  const config = MAPS[draft.mapId];
  miniMap = new maplibregl.Map({ container: "mobile-mini-map", style: createMapStyle("warm", new URL(`../${config.tile}`, location.href).href), center: coordinates || config.center, zoom: coordinates ? 15 : config.zoom, minZoom: config.minZoom, maxZoom: 18, maxBounds: config.bounds, attributionControl: false });
  marker = new maplibregl.Marker({ color: "#A25F45", draggable: true }).setLngLat(coordinates || config.center).addTo(miniMap);
  marker.on("dragend", () => updateManual(marker.getLngLat()));
  miniMap.on("click", (event) => {
    const poi = miniMap.getLayer("pois")
      ? miniMap.queryRenderedFeatures(event.point, { layers: ["pois"] }).map(poiSelection).find(Boolean) : null;
    if (poi && insideMap(poi.coordinates)) {
      coordinates = poi.coordinates;
      marker.setLngLat(coordinates);
      if (!$("mobile-title").value.trim()) { $("mobile-title").value = poi.title; $("mobile-category").value = poi.category; }
      $("mobile-location-value").textContent = poi.title;
      saveLocal();
    } else { marker.setLngLat(event.lngLat); updateManual(event.lngLat); }
  });
}

async function updateManual(lngLat) {
  const next = [lngLat.lng, lngLat.lat];
  if (!insideMap(next)) return showToast("位置不在当前地图范围内");
  coordinates = next; $("mobile-location-value").textContent = formatCoordinates(coordinates); saveLocal();
  try { $("mobile-location-value").textContent = (await reverseLocation(draft.mapId, coordinates)).address; } catch {}
}

async function onFiles(event) {
  const files = [...event.target.files]; event.target.value = "";
  if (photos.length + files.length > 4) return showToast("每条记录最多 4 张照片");
  for (const file of files) {
    const position = nextPosition();
    const local = { id: `local-${crypto.randomUUID()}`, position, localUrl: URL.createObjectURL(file), uploading: true };
    photos.push(local); renderPhotos();
    try {
      const processed = await processPhoto(file);
      const result = await uploadDraftPhoto(token, photoForm(processed, position));
      Object.assign(local, result.photo, { uploading: false });
    } catch (error) { photos = photos.filter((item) => item !== local); showToast(error.message); }
    renderPhotos();
  }
}

function renderPhotos() {
  const box = $("mobile-photo-list"); box.replaceChildren();
  photos.sort((a,b) => a.position-b.position).forEach((photo) => {
    const wrap = document.createElement("div"); wrap.className = `photo-preview${photo.uploading ? " is-uploading" : ""}`;
    const image = document.createElement("img"); image.src = photo.localUrl || draftPhotoUrl(token, photo.id, true); image.alt = "待上传照片";
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.disabled = photo.uploading;
    remove.addEventListener("click", async () => { try { if (!photo.id.startsWith("local-")) await deleteDraftPhoto(token, photo.id); if (photo.localUrl) URL.revokeObjectURL(photo.localUrl); photos = photos.filter((item) => item !== photo); renderPhotos(); } catch (error) { showToast(error.message); } });
    wrap.append(image, remove); box.append(wrap);
  });
}

async function onSubmit(event) {
  event.preventDefault(); if (photos.some((photo) => photo.uploading)) return showToast("请等待照片上传完成");
  const button = $("mobile-submit"); button.disabled = true;
  try {
    if (draft.type === "new_place" && !insideMap(coordinates)) throw new Error("请先选择当前地图范围内的位置");
    const entry = { text: $("mobile-text").value, visitedOn: $("mobile-date").value || null };
    const payload = draft.type === "new_entry" ? { entry } : { place: { title: $("mobile-title").value, category: $("mobile-category").value, tags: $("mobile-tags").value.split(/[，,]/).map((v)=>v.trim()).filter(Boolean), coordinates, text: entry.text, visitedOn: entry.visitedOn } };
    const result = await submitMobileDraft(token, payload);
    finishSubmission(result.status === "published");
  } catch (error) {
    if (isNetworkError(error)) {
      try {
        const current = await getMobileDraft(token);
        if (current.draft.status === "submitted") return finishSubmission(Boolean(current.draft.result?.entryId));
      } catch {}
      showToast("连接不稳定，内容仍保留，请再次提交");
    } else {
      showToast(error.message);
    }
    button.disabled = false;
  }
}

function finishSubmission(published) {
  localStorage.removeItem(storageKey());
  showComplete(published ? "已发布" : "已提交", published ? "这条记录已经出现在地图上。" : "投稿已进入待审核。");
}

function saveLocal() { try { localStorage.setItem(storageKey(), JSON.stringify({ coordinates, title: $("mobile-title").value, category: $("mobile-category").value, tags: $("mobile-tags").value, date: $("mobile-date").value, text: $("mobile-text").value })); } catch {} }
function restoreLocal() { try { const value = JSON.parse(localStorage.getItem(storageKey())); if (!value) return; coordinates = value.coordinates || coordinates; $("mobile-title").value = value.title || ""; $("mobile-category").value = value.category || "food"; $("mobile-tags").value = value.tags || ""; $("mobile-date").value = value.date || ""; $("mobile-text").value = value.text || ""; } catch {} }
function storageKey() { return `walking-map-mobile:${token}`; }
function nextPosition() { const used = new Set(photos.map((photo)=>photo.position)); for (let i=0;i<4;i++) if (!used.has(i)) return i; return 4; }
function formatCoordinates(value) { return value ? `${value[0].toFixed(5)}, ${value[1].toFixed(5)}` : "尚未选择位置"; }
function insideMap(value) { const bounds = MAPS[draft.mapId]?.bounds; return Array.isArray(value) && bounds && value[0] >= bounds[0][0] && value[0] <= bounds[1][0] && value[1] >= bounds[0][1] && value[1] <= bounds[1][1]; }
function formatDistance(value) { return Number.isFinite(value) ? (value < 1000 ? `${value} m` : `${(value / 1000).toFixed(1)} km`) : ""; }
function showComplete(title, message) { $("mobile-loading").hidden = true; $("mobile-form").hidden = true; $("mobile-error").hidden = true; $("mobile-complete").hidden = false; $("complete-title").textContent = title; $("complete-message").textContent = message; }
function showFatal(error) { $("mobile-loading").hidden = true; $("mobile-error").hidden = false; $("mobile-error-message").textContent = error.message || "请稍后重试"; }
function showToast(message) { clearTimeout(toastTimer); $("mobile-toast").textContent = message; $("mobile-toast").hidden = false; toastTimer = setTimeout(()=>{$("mobile-toast").hidden=true},3000); }

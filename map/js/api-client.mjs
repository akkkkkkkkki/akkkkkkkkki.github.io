import { validateData } from "./data-store.mjs";

const apiBase = String(globalThis.WALKING_MAP_CONFIG?.apiBase || "").replace(/\/$/, "");
const API_TIMEOUT_MS = 5000;
const MOBILE_SUBMIT_TIMEOUT_MS = 20_000;
const NETWORK_ERROR_MESSAGE = "网络连接失败，请切换网络或开启代理后重试";

export function contributionEnabled() {
  return Boolean(apiBase);
}

export async function loadMapData(mapId = "shanghai") {
  const fallbackPath = mapId === "beijing" ? "data/map-data-beijing.json" : "data/map-data.json";
  const fallbackPromise = loadAndValidate(fallbackPath, { cache: "no-store" });
  if (!apiBase) return { ...(await fallbackPromise), source: "static" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);
  try {
    const result = await loadAndValidate(`${apiBase}/v1/map?city=${encodeURIComponent(mapId)}`, { signal: controller.signal });
    if (!result.data.places.length && result.errors.length) throw new Error("云端地点数据不完整");
    return { ...result, source: "cloud" };
  } catch (error) {
    console.warn("Walking Map API unavailable; using static data", error);
    return { ...(await fallbackPromise), source: "static", fallbackReason: error };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyInvite(key) {
  return apiRequest("/v1/invites/verify", { key });
}

export async function submitPlace(key, place) {
  return submitContribution(key, { type: "new_place", place });
}

export async function submitContribution(key, submission) {
  return apiRequest("/v1/submissions", { key, submission });
}

export async function requestInvite(request) {
  return apiRequest("/v1/key-requests", request);
}

export async function createMobileDraft(key, setup) {
  return apiRequest("/v1/mobile-drafts", { key, setup });
}

export async function getMobileDraft(token) {
  return apiGet(`/v1/mobile-drafts/${encodeURIComponent(token)}`);
}

export async function markMobileDraftOpened(token) {
  return apiRequest(`/v1/mobile-drafts/${encodeURIComponent(token)}/opened`, {});
}

export async function cancelMobileDraft(token) {
  return apiFetch(`/v1/mobile-drafts/${encodeURIComponent(token)}`, { method: "DELETE" });
}

export async function submitMobileDraft(token, payload) {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  return apiFetch(`/v1/mobile-drafts/${encodeURIComponent(token)}/submit`, { method: "POST", body: form }, MOBILE_SUBMIT_TIMEOUT_MS);
}

export async function searchPlaces(mapId, keywords, center) {
  try {
    return await apiRequest("/v1/geo/search", { mapId, keywords, center });
  } catch (error) {
    if (isNetworkError(error)) throw new Error("地点搜索连接失败，请稍后重试");
    throw error;
  }
}

export async function reverseLocation(mapId, coordinates) {
  return apiRequest("/v1/geo/reverse", { mapId, coordinates });
}

export async function uploadDraftPhoto(token, formData) {
  return apiFetch(`/v1/mobile-drafts/${encodeURIComponent(token)}/photos`, { method: "POST", body: formData }, 20_000);
}

export async function deleteDraftPhoto(token, photoId) {
  return apiFetch(`/v1/mobile-drafts/${encodeURIComponent(token)}/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
}

export function draftPhotoUrl(token, photoId, thumbnail = false) {
  return `${apiBase}/v1/mobile-drafts/${encodeURIComponent(token)}/photos/${encodeURIComponent(photoId)}${thumbnail ? "/thumb" : ""}`;
}

export function publicPhotoUrl(photo, thumbnail = false) {
  return `${apiBase}/v1/photos/${encodeURIComponent(photo.id)}${thumbnail ? "/thumb" : ""}`;
}

async function loadAndValidate(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`地点数据加载失败（${response.status}）`);
  return validateData(await response.json());
}

async function apiRequest(path, body, options) {
  if (!apiBase) throw new Error("投稿入口还没有启用");
  return postJson(`${apiBase}${path}`, body, options);
}

async function apiGet(path) {
  return apiFetch(path, { method: "GET" });
}

async function apiFetch(path, init, timeoutMs = API_TIMEOUT_MS) {
  if (!apiBase) throw new Error("投稿入口还没有启用");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}${path}`, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "请求失败，请稍后重试");
    return data;
  } catch (error) {
    if (error instanceof Error && error.message && error.message !== "Failed to fetch" && error.name !== "AbortError") throw error;
    throw networkError();
  } finally { clearTimeout(timer); }
}

export async function postJson(url, body, { fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      // text/plain keeps the JSON body but makes this a CORS simple request,
      // avoiding a fragile OPTIONS round trip to the public Worker.
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch {
    throw networkError();
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "提交失败，请稍后重试");
  return data;
}

export function isNetworkError(error) {
  return error?.code === "NETWORK_ERROR";
}

function networkError() {
  const error = new Error(NETWORK_ERROR_MESSAGE);
  error.code = "NETWORK_ERROR";
  return error;
}

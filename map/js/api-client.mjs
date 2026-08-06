import { validateData } from "./data-store.mjs";

const apiBase = String(globalThis.WALKING_MAP_CONFIG?.apiBase || "").replace(/\/$/, "");

export function contributionEnabled() {
  return Boolean(apiBase);
}

export async function loadMapData() {
  const fallbackPromise = loadAndValidate("data/map-data.json", { cache: "no-store" });
  if (!apiBase) return { ...(await fallbackPromise), source: "static" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);
  try {
    const result = await loadAndValidate(`${apiBase}/v1/map`, { signal: controller.signal });
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
  return apiRequest("/v1/submissions", { key, place });
}

async function loadAndValidate(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`地点数据加载失败（${response.status}）`);
  return validateData(await response.json());
}

async function apiRequest(path, body) {
  if (!apiBase) throw new Error("投稿入口还没有启用");
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "提交失败，请稍后重试");
  return data;
}

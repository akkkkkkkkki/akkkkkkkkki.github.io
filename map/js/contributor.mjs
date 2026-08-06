import { contributionEnabled, submitPlace, verifyInvite } from "./api-client.mjs";

const $ = (id) => document.getElementById(id);

export function createContributor({ map, showToast, closeOtherPanels, reloadData }) {
  let selecting = false;
  let marker = null;
  let accessLevel = null;

  $("contribute-button").addEventListener("click", () => {
    if (!contributionEnabled()) {
      showToast("投稿入口还没有启用");
      return;
    }
    closeOtherPanels();
    const panel = $("contribute-panel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) restoreKey();
  });
  $("contribute-close").addEventListener("click", close);

  $("invite-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("verify-key-button");
    setBusy(button, true);
    try {
      const key = $("invite-key").value.trim();
      const result = await verifyInvite(key);
      if (!result.valid) throw new Error("key 无效或已停用");
      accessLevel = result.accessLevel;
      try { sessionStorage.setItem("walking-map-invite", key); } catch {}
      $("contribution-fields").hidden = false;
      $("invite-status").textContent = accessLevel === "trusted" ? "信任 key · 提交后直接发布" : "key 有效 · 提交后等待审核";
      $("choose-location-button").focus();
    } catch (error) {
      accessLevel = null;
      $("contribution-fields").hidden = true;
      $("invite-status").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });

  $("choose-location-button").addEventListener("click", () => {
    selecting = true;
    $("contribute-panel").hidden = true;
    $("contribute-button").classList.add("is-active");
    showToast("请在地图上点击地点的位置");
  });

  $("contribution-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("submit-contribution-button");
    setBusy(button, true);
    try {
      const coordinates = [Number($("contribution-lng").value), Number($("contribution-lat").value)];
      if (!coordinates.every(Number.isFinite)) throw new Error("请先在地图上选择位置");
      const result = await submitPlace($("invite-key").value.trim(), {
        title: $("contribution-title").value,
        category: $("contribution-category").value,
        tags: $("contribution-tags").value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
        coordinates,
        text: $("contribution-text").value,
        visitedOn: null
      });
      const published = result.status === "published";
      showToast(published ? "已发布" : "已提交，等待审核");
      resetForm();
      close();
      if (published) await reloadData();
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy(button, false);
    }
  });

  function handleMapClick(lngLat) {
    if (!selecting) return false;
    selecting = false;
    $("contribute-button").classList.remove("is-active");
    $("contribution-lng").value = lngLat.lng.toFixed(6);
    $("contribution-lat").value = lngLat.lat.toFixed(6);
    marker?.remove();
    marker = new maplibregl.Marker({ color: "#A25F45" }).setLngLat(lngLat).addTo(map);
    $("location-summary").textContent = `${lngLat.lng.toFixed(5)}, ${lngLat.lat.toFixed(5)}`;
    $("contribute-panel").hidden = false;
    $("contribution-title").focus();
    return true;
  }

  function restoreKey() {
    if ($("invite-key").value) return;
    try { $("invite-key").value = sessionStorage.getItem("walking-map-invite") || ""; } catch {}
  }

  function resetForm() {
    $("contribution-form").reset();
    $("contribution-lng").value = "";
    $("contribution-lat").value = "";
    $("location-summary").textContent = "尚未选择位置";
    marker?.remove(); marker = null;
  }

  function close() {
    selecting = false;
    $("contribute-button").classList.remove("is-active");
    $("contribute-panel").hidden = true;
  }

  return { handleMapClick, close };
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

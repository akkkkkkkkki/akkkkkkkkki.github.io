import { contributionEnabled, requestInvite, submitContribution, verifyInvite } from "./api-client.mjs";
import { hidePanel, panelIsOpen, showPanel } from "./panel-motion.mjs";

const $ = (id) => document.getElementById(id);

export function createContributor({ map, showToast, closeOtherPanels, reloadData }) {
  let selecting = false;
  let marker = null;
  let accessLevel = null;
  let displayName = null;
  let mode = "new_place";
  let targetPlace = null;
  const panel = $("contribute-panel");

  $("contribute-button").addEventListener("click", () => {
    if (!contributionEnabled()) return showToast("投稿入口还没有启用");
    if (panelIsOpen(panel)) return close();
    closeOtherPanels();
    setMode("new_place");
    restoreKey();
    showPanel(panel);
  });
  $("contribute-close").addEventListener("click", close);

  $("show-key-request-button").addEventListener("click", () => {
    $("invite-form").hidden = true;
    $("contribution-fields").hidden = true;
    $("show-key-request-button").hidden = true;
    $("key-request-form").hidden = false;
    $("key-request-name").focus();
  });
  $("cancel-key-request-button").addEventListener("click", closeKeyRequest);
  $("key-request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("submit-key-request-button");
    setBusy(button, true);
    try {
      await requestInvite({
        displayName: $("key-request-name").value,
        email: $("key-request-email").value,
        note: $("key-request-note").value
      });
      $("key-request-form").reset();
      closeKeyRequest();
      showToast("申请已提交，请等待邮件回复");
    } catch (error) {
      showToast(error.message);
    } finally {
      setBusy(button, false);
    }
  });

  $("invite-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("verify-key-button");
    setBusy(button, true);
    try {
      const key = $("invite-key").value.trim();
      const result = await verifyInvite(key);
      if (!result.valid) throw new Error("key 无效或已停用");
      accessLevel = result.accessLevel;
      displayName = result.displayName;
      try { sessionStorage.setItem("walking-map-invite", key); } catch {}
      $("contribution-fields").hidden = false;
      const permission = accessLevel === "trusted" ? "直接发布" : "等待审核";
      $("invite-status").textContent = displayName ? `${displayName} · ${permission}` : permission;
      (mode === "new_entry" ? $("contribution-text") : $("choose-location-button")).focus();
    } catch (error) {
      accessLevel = null;
      displayName = null;
      $("contribution-fields").hidden = true;
      $("invite-status").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });

  $("choose-location-button").addEventListener("click", () => {
    selecting = true;
    hidePanel(panel);
    $("contribute-button").classList.add("is-active");
    showToast("请在地图上点击地点的位置");
  });

  $("contribution-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("submit-contribution-button");
    setBusy(button, true);
    try {
      const submission = mode === "new_entry" ? buildEntrySubmission() : buildPlaceSubmission();
      const result = await submitContribution($("invite-key").value.trim(), submission);
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

  function buildPlaceSubmission() {
    const coordinates = [Number($("contribution-lng").value), Number($("contribution-lat").value)];
    if (!coordinates.every(Number.isFinite)) throw new Error("请先在地图上选择位置");
    return {
      type: "new_place",
      place: {
        title: $("contribution-title").value,
        category: $("contribution-category").value,
        tags: $("contribution-tags").value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
        coordinates,
        text: $("contribution-text").value,
        visitedOn: $("contribution-date").value || null
      }
    };
  }

  function buildEntrySubmission() {
    if (!targetPlace) throw new Error("目标地点不存在，请重新选择");
    return {
      type: "new_entry",
      placeId: targetPlace.id,
      entry: {
        text: $("contribution-text").value,
        visitedOn: $("contribution-date").value || null
      }
    };
  }

  function handleMapClick(lngLat) {
    if (!selecting) return false;
    selecting = false;
    $("contribute-button").classList.remove("is-active");
    $("contribution-lng").value = lngLat.lng.toFixed(6);
    $("contribution-lat").value = lngLat.lat.toFixed(6);
    marker?.remove();
    marker = new maplibregl.Marker({ color: "#A25F45" }).setLngLat(lngLat).addTo(map);
    $("location-summary").textContent = `${lngLat.lng.toFixed(5)}, ${lngLat.lat.toFixed(5)}`;
    showPanel(panel);
    $("contribution-title").focus();
    return true;
  }

  function openForPlace(place) {
    if (!contributionEnabled()) return showToast("投稿入口还没有启用");
    closeOtherPanels();
    setMode("new_entry", place);
    restoreKey();
    showPanel(panel);
    ($("invite-key").value ? $("verify-key-button") : $("invite-key")).focus();
  }

  function setMode(nextMode, place = null) {
    mode = nextMode;
    targetPlace = place;
    const newPlace = mode === "new_place";
    $("new-place-fields").hidden = !newPlace;
    $("location-picker").hidden = !newPlace;
    $("contribution-title").required = newPlace;
    $("contribution-place-id").value = place?.id || "";
    $("contribution-mode").textContent = newPlace ? "New place" : `Add to · ${place.title}`;
  }

  function restoreKey() {
    if ($("invite-key").value) return;
    try { $("invite-key").value = sessionStorage.getItem("walking-map-invite") || ""; } catch {}
  }

  function resetForm() {
    $("contribution-form").reset();
    $("contribution-lng").value = "";
    $("contribution-lat").value = "";
    $("contribution-place-id").value = "";
    $("location-summary").textContent = "尚未选择位置";
    marker?.remove();
    marker = null;
    targetPlace = null;
    setMode("new_place");
  }

  function closeKeyRequest() {
    $("key-request-form").hidden = true;
    $("invite-form").hidden = false;
    $("show-key-request-button").hidden = false;
  }

  function close() {
    selecting = false;
    $("contribute-button").classList.remove("is-active");
    hidePanel(panel);
    closeKeyRequest();
  }

  return { handleMapClick, openForPlace, close };
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

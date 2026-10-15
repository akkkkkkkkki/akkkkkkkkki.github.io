import { cancelMobileDraft, contributionEnabled, createMobileDraft, deleteDraftPhoto, draftPhotoUrl, getMobileDraft, requestInvite, submitContribution, submitMobileDraft, uploadDraftPhoto, verifyInvite } from "./api-client.mjs";
import { hidePanel, panelIsOpen, showPanel } from "./panel-motion.mjs";
import { photoForm, processPhoto } from "./photo-processing.mjs";
import { drawQr } from "./qr.mjs";
import { withDraftPrefill } from "./poi-selection.mjs";

const $ = (id) => document.getElementById(id);

export function createContributor({ map, showToast, closeOtherPanels, reloadData, getMapId }) {
  let selecting = false;
  let marker = null;
  let accessLevel = null;
  let displayName = null;
  let mode = "new_place";
  let targetPlace = null;
  let draftPoll = null;
  let draftToken = null;
  let draftExpiresAt = null;
  let draftUrl = null;
  let photos = [];
  let mobileHandoff = false;
  const panel = $("contribute-panel");

  $("contribute-button").addEventListener("click", () => {
    if (!contributionEnabled()) return showToast("投稿入口还没有启用");
    if (panelIsOpen(panel)) return close();
    closeOtherPanels();
    if (mobileHandoff) {
      showPanel(panel);
      if (draftToken) pollDraft(draftToken);
      return;
    }
    setMode("new_place");
    restoreKey();
    showPanel(panel);
    if (draftToken) pollDraft(draftToken);
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
      $("show-key-request-button").hidden = true;
      $("invite-status").textContent = displayName ? `${displayName} · Verified` : "Verified";
      updateContentVisibility({ scroll: true });
      (mode === "new_entry" || $("contribution-lng").value ? $("contribution-text") : $("choose-location-button")).focus();
    } catch (error) {
      accessLevel = null;
      displayName = null;
      $("contribution-fields").hidden = true;
      $("show-key-request-button").hidden = false;
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
      if (photos.some((photo) => photo.uploading)) throw new Error("请等待照片上传完成");
      const submission = mode === "new_entry" ? buildEntrySubmission() : buildPlaceSubmission();
      const result = draftToken
        ? await submitMobileDraft(draftToken, submission.type === "new_entry" ? { entry: submission.entry } : { place: submission.place })
        : await submitContribution($("invite-key").value.trim(), submission);
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

  $("choose-contribution-photo-button").addEventListener("click", () => $("contribution-photo-input").click());
  $("cancel-mobile-draft-button").addEventListener("click", async () => {
    const button = $("cancel-mobile-draft-button"); setBusy(button, true);
    try {
      await cancelMobileDraft(draftToken);
      invalidateDraft(); setMobileHandoff(false); showToast("已取消手机填写");
    } catch (error) { showToast(error.message); }
    finally { setBusy(button, false); }
  });

  function buildPlaceSubmission() {
    const coordinates = [Number($("contribution-lng").value), Number($("contribution-lat").value)];
    if (!coordinates.every(Number.isFinite)) throw new Error("请先在地图上选择位置");
    return {
      type: "new_place",
      mapId: getMapId(),
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
      mapId: getMapId(),
      placeId: targetPlace.id,
      entry: {
        text: $("contribution-text").value,
        visitedOn: $("contribution-date").value || null
      }
    };
  }

  function handleMapClick(lngLat, poi = null) {
    if (!selecting) return false;
    selecting = false;
    invalidateDraft();
    $("contribute-button").classList.remove("is-active");
    setLocation(lngLat, poi);
    showPanel(panel);
    updateContentVisibility({ scroll: true });
    (poi ? $("contribution-text") : $("contribution-title")).focus();
    return true;
  }

  function setLocation(lngLat, poi = null) {
    if (poi) {
      lngLat = { lng: poi.coordinates[0], lat: poi.coordinates[1] };
      $("contribution-title").value = poi.title;
      $("contribution-category").value = poi.category;
    }
    $("contribution-lng").value = lngLat.lng.toFixed(6);
    $("contribution-lat").value = lngLat.lat.toFixed(6);
    marker?.remove();
    marker = new maplibregl.Marker({ color: "#A25F45" }).setLngLat(lngLat).addTo(map);
    $("location-summary").textContent = poi?.title || `${lngLat.lng.toFixed(5)}, ${lngLat.lat.toFixed(5)}`;
  }

  function openForPoi(poi) {
    if (!contributionEnabled()) return showToast("投稿入口还没有启用");
    // Opening another shop must not discard text, uploaded images or a QR draft.
    const hasDraft = draftToken || mobileHandoff || photos.length || ["contribution-text", "contribution-tags", "contribution-date"].some((id) => $(id).value.trim());
    closeOtherPanels();
    if (hasDraft) {
      showPanel(panel);
      if (draftToken) pollDraft(draftToken);
      showToast("当前还有未完成的填写，请先完成；调整位置可使用选点按钮");
      return;
    }
    resetForm();
    setLocation(null, poi);
    restoreKey();
    showPanel(panel);
    updateContentVisibility({ scroll: true });
    (accessLevel ? $("contribution-text") : $("invite-key").value ? $("verify-key-button") : $("invite-key")).focus();
  }

  function openForPlace(place) {
    if (!contributionEnabled()) return showToast("投稿入口还没有启用");
    closeOtherPanels();
    setMode("new_entry", place);
    restoreKey();
    showPanel(panel);
    if (draftToken) pollDraft(draftToken);
    ($("invite-key").value ? $("verify-key-button") : $("invite-key")).focus();
  }

  function setMode(nextMode, place = null) {
    if (mode !== nextMode || targetPlace?.id !== place?.id) invalidateDraft();
    mode = nextMode;
    targetPlace = place;
    const newPlace = mode === "new_place";
    $("new-place-fields").hidden = !newPlace;
    $("location-picker").hidden = !newPlace;
    $("contribution-title").required = newPlace;
    $("contribution-place-id").value = place?.id || "";
    $("contribution-mode").textContent = newPlace ? "New place" : `Add to · ${place.title}`;
    updateContentVisibility();
  }

  $("create-mobile-draft-button").addEventListener("click", async () => {
    const button = $("create-mobile-draft-button"); setBusy(button, true);
    try {
      const result = await ensureDraft();
      await renderQr(result.url, result.expiresAt); pollDraft(result.token);
    } catch (error) { showToast(error.message); } finally { setBusy(button, false); }
  });

  $("contribution-photo-input").addEventListener("change", async (event) => {
    const files = [...event.target.files]; event.target.value = "";
    if (photos.length + files.length > 4) return showToast("每条记录最多 4 张照片");
    try {
      const draft = await ensureDraft();
      for (const file of files) {
        const position = nextPhotoPosition();
        const local = { id: `local-${crypto.randomUUID()}`, position, localUrl: URL.createObjectURL(file), uploading: true };
        photos.push(local); renderPhotos();
        try {
          const result = await uploadDraftPhoto(draft.token, photoForm(await processPhoto(file), position));
          Object.assign(local, result.photo, { uploading: false });
        } catch (error) {
          URL.revokeObjectURL(local.localUrl); photos = photos.filter((photo) => photo !== local); showToast(error.message);
        }
        renderPhotos();
      }
    } catch (error) { showToast(error.message); }
  });

  async function ensureDraft() {
    if (draftToken && draftExpiresAt > Date.now()) return { token: draftToken, expiresAt: new Date(draftExpiresAt).toISOString(), url: prefillDraftUrl(draftUrl) };
    const setup = mode === "new_entry"
      ? { type: "new_entry", mapId: getMapId(), placeId: targetPlace.id }
      : { type: "new_place", mapId: getMapId(), coordinates: [Number($("contribution-lng").value), Number($("contribution-lat").value)] };
    const result = await createMobileDraft($("invite-key").value.trim(), setup);
    draftToken = result.token; draftExpiresAt = new Date(result.expiresAt).getTime(); draftUrl = result.url;
    return { ...result, url: prefillDraftUrl(result.url) };
  }

  function prefillDraftUrl(url) {
    return mode === "new_place" ? withDraftPrefill(url, { title: $("contribution-title").value, category: $("contribution-category").value }) : url;
  }

  function renderPhotos() {
    const box = $("contribution-photo-list"); box.replaceChildren();
    photos.sort((a, b) => a.position - b.position).forEach((photo) => {
      const wrap = document.createElement("div"); wrap.className = `contribution-photo${photo.uploading ? " is-uploading" : ""}`;
      const image = document.createElement("img"); image.src = photo.localUrl || draftPhotoUrl(draftToken, photo.id, true); image.alt = "待提交照片";
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.disabled = photo.uploading;
      remove.addEventListener("click", async () => { try { if (!photo.id.startsWith("local-")) await deleteDraftPhoto(draftToken, photo.id); if (photo.localUrl) URL.revokeObjectURL(photo.localUrl); photos = photos.filter((item) => item !== photo); renderPhotos(); } catch (error) { showToast(error.message); } });
      wrap.append(image, remove); box.append(wrap);
    });
    $("contribution-photo-count").textContent = `${photos.length}/4`;
    $("choose-contribution-photo-button").disabled = photos.length >= 4;
  }

  function nextPhotoPosition() { const used = new Set(photos.map((photo) => photo.position)); for (let i = 0; i < 4; i += 1) if (!used.has(i)) return i; return 4; }

  function invalidateDraft() {
    clearInterval(draftPoll); draftPoll = null; draftToken = null; draftExpiresAt = null; draftUrl = null;
    photos.forEach((photo) => { if (photo.localUrl) URL.revokeObjectURL(photo.localUrl); }); photos = []; renderPhotos();
    $("mobile-draft-box").hidden = true; $("mobile-draft-box").classList.remove("is-complete");
    $("mobile-handoff").classList.remove("is-complete");
    $("mobile-handoff-status").textContent = "手机填写中…";
    $("cancel-mobile-draft-button").hidden = false;
  }

  function updateContentVisibility({ scroll = false } = {}) {
    const ready = !mobileHandoff && Boolean(accessLevel) && (mode === "new_entry" || Boolean($("contribution-lng").value));
    const fields = $("contribution-content-fields");
    const wasHidden = fields.hidden;
    fields.hidden = !ready;
    $("create-mobile-draft-button").hidden = !ready;
    if (ready && wasHidden && scroll) scrollPanelTo(fields);
  }

  async function renderQr(url, expiresAt) {
    const box = $("mobile-draft-box");
    const canvas = $("mobile-draft-qr");
    box.hidden = true;
    try { drawQr(canvas, url); }
    catch (error) { throw new Error(error?.message || "二维码生成失败，请使用 Open 链接"); }
    $("mobile-draft-link").href = url;
    $("mobile-draft-status").textContent = "手机扫码填写";
    $("mobile-draft-expiry").textContent = `有效至 ${new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    box.classList.remove("is-complete"); box.hidden = false;
    scrollPanelTo(box);
  }

  function scrollPanelTo(element) {
    requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect(), elementRect = element.getBoundingClientRect();
      const top = Math.max(0, panel.scrollTop + elementRect.top - panelRect.top - 14);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      panel.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    });
  }

  function pollDraft(token) {
    clearInterval(draftPoll);
    const checkDraft = async () => {
      try {
        const result = await getMobileDraft(token);
        if (token !== draftToken) return;
        if (result.draft.status === "cancelled") {
          invalidateDraft();
          setMobileHandoff(false);
          showToast("手机填写已取消");
          return;
        }
        if (result.draft.openedAt && !mobileHandoff) setMobileHandoff(true);
        if (result.draft.status === "submitted") {
          clearInterval(draftPoll); draftPoll = null;
          setMobileHandoff(true, { complete: true });
          await reloadData();
        }
      } catch {}
    };
    draftPoll = setInterval(checkDraft, 4000);
    void checkDraft();
  }

  function setMobileHandoff(active, { complete = false } = {}) {
    mobileHandoff = active;
    $("mobile-handoff").hidden = !active;
    $("invite-form").hidden = active;
    $("key-request-form").hidden = true;
    $("show-key-request-button").hidden = active || Boolean(accessLevel);
    $("contribution-fields").hidden = active || !accessLevel;
    $("mobile-draft-box").hidden = true;
    if (active) {
      $("mobile-handoff").classList.toggle("is-complete", complete);
      $("mobile-handoff-status").textContent = complete ? "✓ 已完成" : "手机填写中…";
      $("cancel-mobile-draft-button").hidden = complete;
      if (panelIsOpen(panel)) scrollPanelTo($("mobile-handoff"));
    } else {
      $("mobile-handoff").classList.remove("is-complete");
      $("cancel-mobile-draft-button").hidden = false;
      updateContentVisibility({ scroll: true });
    }
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
    invalidateDraft();
    setMobileHandoff(false);
    marker?.remove();
    marker = null;
    targetPlace = null;
    setMode("new_place");
    updateContentVisibility();
  }

  function closeKeyRequest() {
    $("key-request-form").hidden = true;
    $("invite-form").hidden = mobileHandoff;
    $("show-key-request-button").hidden = mobileHandoff || Boolean(accessLevel);
  }

  function close() {
    selecting = false;
    if (!mobileHandoff) { clearInterval(draftPoll); draftPoll = null; }
    $("contribute-button").classList.remove("is-active");
    hidePanel(panel);
    closeKeyRequest();
  }

  return { handleMapClick, openForPlace, openForPoi, close };
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

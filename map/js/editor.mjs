import { makeId, validateData } from "./data-store.mjs";

const $ = (id) => document.getElementById(id);

export function createEditor({ map, getData, setData, getSelectedId, showToast }) {
  let dirty = false;
  let waitingForPoint = false;
  let editingCollectionId = null;

  const dock = $("edit-dock");
  const addButton = $("add-place-button");
  const editButton = $("edit-place-button");
  const placePanel = $("place-editor");
  const collectionPanel = $("collection-editor");

  dock.hidden = false;

  function markDirty(value = true) {
    dirty = value;
    document.title = `${dirty ? "● " : ""}上海地点手账 · 编辑`;
  }

  function closePlaceEditor() {
    placePanel.hidden = true;
    waitingForPoint = false;
    addButton.classList.remove("is-active");
  }

  function openPlaceEditor(place = null, coordinates = null) {
    $("place-editor-title").textContent = place ? "编辑地点" : "新增地点";
    $("place-id").value = place?.id || "";
    $("place-title").value = place?.title || "";
    $("place-category").value = place?.category || "food";
    $("place-tags").value = place?.tags.join("，") || "";
    $("place-lng").value = place?.coordinates[0] ?? coordinates?.lng ?? "";
    $("place-lat").value = place?.coordinates[1] ?? coordinates?.lat ?? "";
    $("place-text").value = place?.text || "";
    $("place-photos").value = place?.photos.map((photo) => `${photo.src} | ${photo.alt}`).join("\n") || "";
    $("delete-place-button").hidden = !place;
    placePanel.hidden = false;
    collectionPanel.hidden = true;
    $("place-title").focus();
  }

  function parsePhotos(value) {
    return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const separator = line.indexOf("|");
      return separator < 0
        ? { src: line.trim(), alt: "" }
        : { src: line.slice(0, separator).trim(), alt: line.slice(separator + 1).trim() };
    });
  }

  function saveCandidate(candidate) {
    const result = validateData(candidate);
    if (result.errors.length) {
      showToast(`${result.errors[0].path}：${result.errors[0].message}`);
      return false;
    }
    setData(result.data, []);
    markDirty();
    return true;
  }

  addButton.addEventListener("click", () => {
    waitingForPoint = true;
    closePlaceEditor();
    waitingForPoint = true;
    addButton.classList.add("is-active");
    showToast("请在地图上点击新地点的位置");
  });

  editButton.addEventListener("click", () => {
    const place = getData().places.find((item) => item.id === getSelectedId());
    if (place) openPlaceEditor(place);
  });

  $("place-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = structuredClone(getData());
    const id = $("place-id").value || makeId("place");
    const place = {
      id,
      title: $("place-title").value,
      category: $("place-category").value,
      tags: $("place-tags").value.split(/[，,]/),
      coordinates: [Number($("place-lng").value), Number($("place-lat").value)],
      text: $("place-text").value,
      photos: parsePhotos($("place-photos").value)
    };
    const index = data.places.findIndex((item) => item.id === id);
    if (index >= 0) data.places[index] = place;
    else data.places.push(place);
    if (saveCandidate(data)) {
      closePlaceEditor();
      showToast(index >= 0 ? "地点已更新，记得导出 JSON" : "地点已加入，记得导出 JSON");
    }
  });

  $("delete-place-button").addEventListener("click", () => {
    const id = $("place-id").value;
    const place = getData().places.find((item) => item.id === id);
    if (!place || !window.confirm(`确定删除“${place.title}”吗？它也会从所有点集中移除。`)) return;
    const data = structuredClone(getData());
    data.places = data.places.filter((item) => item.id !== id);
    data.collections = data.collections
      .map((collection) => ({ ...collection, placeIds: collection.placeIds.filter((placeId) => placeId !== id) }))
      .filter((collection) => collection.placeIds.length >= 2);
    if (saveCandidate(data)) {
      closePlaceEditor();
      showToast("地点已删除，记得导出 JSON");
    }
  });

  $("cancel-place-button").addEventListener("click", closePlaceEditor);
  $("place-editor-close").addEventListener("click", closePlaceEditor);

  function renderCollectionMembers(selected = []) {
    const selectedIds = new Set(selected);
    $("collection-members").innerHTML = getData().places.map((place) => `
      <label><input type="checkbox" value="${place.id}" ${selectedIds.has(place.id) ? "checked" : ""}> ${escapeHtml(place.title)}</label>
    `).join("");
  }

  function selectCollectionForEdit(id = null) {
    editingCollectionId = id;
    const collection = getData().collections.find((item) => item.id === id);
    $("edit-collection-id").value = collection?.id || "";
    $("edit-collection-name").value = collection?.name || "";
    $("edit-collection-color").value = collection?.color || "#A56E62";
    $("delete-collection-button").hidden = !collection;
    renderCollectionMembers(collection?.placeIds || []);
    document.querySelectorAll("#collection-editor-list button").forEach((button) => button.classList.toggle("is-active", button.dataset.id === id));
  }

  function renderCollectionEditor() {
    $("collection-editor-list").innerHTML = getData().collections.map((collection) => `
      <button type="button" data-id="${collection.id}">${escapeHtml(collection.name)}</button>
    `).join("");
    document.querySelectorAll("#collection-editor-list button").forEach((button) => button.addEventListener("click", () => selectCollectionForEdit(button.dataset.id)));
    selectCollectionForEdit(getData().collections[0]?.id || null);
  }

  $("manage-collections-button").addEventListener("click", () => {
    placePanel.hidden = true;
    collectionPanel.hidden = false;
    renderCollectionEditor();
  });
  $("collection-editor-close").addEventListener("click", () => { collectionPanel.hidden = true; });
  $("new-collection-button").addEventListener("click", () => selectCollectionForEdit(null));

  $("collection-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = structuredClone(getData());
    const id = $("edit-collection-id").value || makeId("collection");
    const collection = {
      id,
      name: $("edit-collection-name").value,
      color: $("edit-collection-color").value,
      placeIds: [...document.querySelectorAll("#collection-members input:checked")].map((input) => input.value)
    };
    const index = data.collections.findIndex((item) => item.id === id);
    if (index >= 0) data.collections[index] = collection;
    else data.collections.push(collection);
    if (saveCandidate(data)) {
      renderCollectionEditor();
      selectCollectionForEdit(id);
      showToast("点集已保存，记得导出 JSON");
    }
  });

  $("delete-collection-button").addEventListener("click", () => {
    const collection = getData().collections.find((item) => item.id === editingCollectionId);
    if (!collection || !window.confirm(`确定删除点集“${collection.name}”吗？地点本身不会被删除。`)) return;
    const data = structuredClone(getData());
    data.collections = data.collections.filter((item) => item.id !== collection.id);
    if (saveCandidate(data)) {
      renderCollectionEditor();
      showToast("点集已删除，记得导出 JSON");
    }
  });

  $("import-button").addEventListener("click", () => $("import-input").click());
  $("import-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const result = validateData(parsed);
      if (result.data.places.length === 0 && result.errors.length) throw new Error(result.errors[0].message);
      setData(result.data, result.errors);
      markDirty();
      showToast(result.errors.length ? `已导入，并跳过 ${result.errors.length} 个问题` : "JSON 已导入，记得重新导出");
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  });

  $("export-button").addEventListener("click", () => {
    const result = validateData(getData());
    if (result.errors.length) {
      showToast(`${result.errors[0].path}：${result.errors[0].message}`);
      return;
    }
    const blob = new Blob([`${JSON.stringify(result.data, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "map-data.json";
    anchor.click();
    URL.revokeObjectURL(url);
    markDirty(false);
    showToast("map-data.json 已导出");
  });

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  return {
    handleMapClick(lngLat) {
      if (!waitingForPoint) return false;
      waitingForPoint = false;
      addButton.classList.remove("is-active");
      openPlaceEditor(null, lngLat);
      return true;
    },
    onSelection(id) { editButton.disabled = !id; },
    refresh() { if (!collectionPanel.hidden) renderCollectionEditor(); }
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

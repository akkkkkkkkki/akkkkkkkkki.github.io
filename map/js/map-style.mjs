const warmOverrides = {
  background: "#E8E2D6",
  earth: "#E7E1D5",
  park_a: "#DCE5D6",
  park_b: "#CEDDCE",
  hospital: "#E9DDD9",
  industrial: "#DED9D0",
  school: "#E9E3D3",
  wood_a: "#D5E0D3",
  wood_b: "#C5D8C4",
  pedestrian: "#E9E2D6",
  scrub_a: "#DCE4D4",
  scrub_b: "#CCDCC7",
  water: "#AFCFD1",
  buildings: "#D8CFC1",
  railway: "#B3A99D",
  boundaries: "#B9AC9D",
  minor_service_casing: "#D9D0C2",
  minor_casing: "#D9D0C2",
  link_casing: "#D9D0C2",
  major_casing_late: "#D4CABD",
  highway_casing_late: "#D4CABD",
  other: "#EFE9DE",
  minor_service: "#EFE9DE",
  minor_a: "#F3EDE3",
  minor_b: "#F7F2E9",
  link: "#FFF9EF",
  major_casing_early: "#D4CABD",
  major: "#FFF9EF",
  highway_casing_early: "#D4CABD",
  highway: "#FFF9EF",
  roads_label_minor: "#675D52",
  roads_label_minor_halo: "#F4EEE4",
  roads_label_major: "#5A5147",
  roads_label_major_halo: "#F4EEE4",
  ocean_label: "#567D83",
  subplace_label: "#756B60",
  subplace_label_halo: "#F4EEE4",
  city_label: "#51483F",
  city_label_halo: "#F4EEE4",
  state_label: "#766C62",
  state_label_halo: "#F4EEE4",
  country_label: "#5A5147",
  address_label: "#756B60",
  address_label_halo: "#F4EEE4"
};

const nightOverrides = {
  background: "#17262B",
  earth: "#1B2C31",
  park_a: "#203831",
  park_b: "#244038",
  hospital: "#352C2D",
  industrial: "#283337",
  school: "#303229",
  wood_a: "#20332F",
  wood_b: "#244039",
  pedestrian: "#223338",
  scrub_a: "#213431",
  scrub_b: "#274039",
  water: "#12343F",
  buildings: "#26373A",
  railway: "#101B1E",
  boundaries: "#3A4D50",
  other: "#26373C",
  minor_service: "#26373C",
  minor_a: "#2B3D41",
  minor_b: "#2E4145",
  link: "#35484C",
  major: "#35484C",
  highway: "#3A5054",
  roads_label_minor: "#9EADA8",
  roads_label_minor_halo: "#192A2F",
  roads_label_major: "#B7C6C0",
  roads_label_major_halo: "#192A2F",
  ocean_label: "#78A5AA",
  subplace_label: "#9AA9A4",
  subplace_label_halo: "#192A2F",
  city_label: "#C0CDC8",
  city_label_halo: "#192A2F",
  state_label: "#82938F",
  state_label_halo: "#192A2F",
  country_label: "#A7B6B1",
  address_label: "#9AA9A4",
  address_label_halo: "#192A2F"
};

function createFlavor(theme) {
  const preset = globalThis.basemaps.namedFlavor(theme === "night" ? "dark" : "light");
  const overrides = theme === "night" ? nightOverrides : warmOverrides;

  return {
    ...preset,
    ...overrides,
    regular: "Noto Sans Regular",
    bold: "Noto Sans Regular",
    italic: "Noto Sans Regular",
    pois: preset.pois ? { ...preset.pois } : undefined,
    landcover: preset.landcover ? { ...preset.landcover } : undefined
  };
}

export function createMapStyle(theme, tileUrl) {
  const base = new URL("../", import.meta.url);
  const flavor = createFlavor(theme);
  const layers = globalThis.basemaps
    .layers("protomaps", flavor, { lang: "zh-Hans" })
    .filter((layer) => layer.id === "pois" || !layer.layout?.["icon-image"])
    .map((layer) => {
      if (layer.id !== "pois") return layer;

      // Keep the bundled POI names without requiring an external icon sprite.
      const { "icon-image": _icon, ...layout } = layer.layout;
      return {
        ...layer,
        minzoom: 14,
        layout: {
          ...layout,
          "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 18, 12],
          "text-offset": [0, 0],
          "text-variable-anchor": ["center", "top", "bottom"],
          "text-padding": 5
        },
        paint: {
          ...layer.paint,
          "text-color": flavor.address_label,
          "text-halo-color": flavor.address_label_halo,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 0.85],
          "text-halo-width": 1.2
        }
      };
    });

  return {
    version: 8,
    glyphs: `${base.href}assets/fonts/{fontstack}/{range}.pbf`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${tileUrl}`,
        attribution: "© OpenStreetMap contributors · Protomaps"
      }
    },
    layers
  };
}

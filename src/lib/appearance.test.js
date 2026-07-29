import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  EFFECTS,
  PANEL_IDS,
  SKINS,
  deserializeAppearance,
  getAllowedEffects,
  filterAppearancePanelsForRole,
  shouldUseLegacyCardTilt,
  isAllowedPair,
  resolvePanelAppearance,
  sanitizeAppearance,
  serializeAppearance,
  resetAppearance,
  withGlobalAppearance,
  withPanelOverride,
  withoutPanelOverride,
} from "./appearance.js";

describe("appearance catalog", () => {
  it("contains exactly 15 stable skins and 15 stable effects", () => {
    expect(SKINS).toHaveLength(15);
    expect(EFFECTS).toHaveLength(15);
    expect(new Set(SKINS.map(({ id }) => id)).size).toBe(15);
    expect(new Set(EFFECTS.map(({ id }) => id)).size).toBe(15);
    expect(Object.values(PANEL_IDS)).toHaveLength(13);
    expect(new Set(Object.values(PANEL_IDS)).size).toBe(13);
    expect(DEFAULT_APPEARANCE).toEqual({ skinId: "classic", effectId: "none", panelOverrides: {}, selfTransferNames: [] });
  });

  it("targets real content cards, including Admin, instead of control wrappers", () => {
    expect(PANEL_IDS.adminUsers).toBe("admin.users");
    expect(PANEL_IDS.adminStats).toBe("admin.stats");
    expect(PANEL_IDS.adminActivity).toBe("admin.activity");
    expect(PANEL_IDS.projectsOverview).toBeUndefined();
    expect(PANEL_IDS.projectsEditor).toBeUndefined();
    expect(PANEL_IDS.tasksFilters).toBeUndefined();
    expect(PANEL_IDS.financeControls).toBeUndefined();
  });

  it("shows Admin appearance targets only to administrators", () => {
    const panels = [
      { id: PANEL_IDS.dashboardKpis },
      { id: PANEL_IDS.adminUsers },
      { id: PANEL_IDS.adminStats },
    ];
    expect(filterAppearancePanelsForRole(panels, "admin")).toEqual(panels);
    expect(filterAppearancePanelsForRole(panels, "user")).toEqual([{ id: PANEL_IDS.dashboardKpis }]);
    expect(filterAppearancePanelsForRole(panels, "client")).toEqual([{ id: PANEL_IDS.dashboardKpis }]);
  });

  it("disables the legacy inline tilt on appearance-managed cards", () => {
    expect(shouldUseLegacyCardTilt("glass-card kp-hover-glow")).toBe(true);
    expect(shouldUseLegacyCardTilt("glass-card kp-appearance-surface kp-effect-tilt")).toBe(false);
    expect(shouldUseLegacyCardTilt("kp-appearance-surface kp-effect-lift")).toBe(false);
  });

  it("exposes only allowed effects for a skin", () => {
    expect(isAllowedPair("classic", "none")).toBe(true);
    expect(isAllowedPair("marble", "tilt")).toBe(true);
    expect(isAllowedPair("unknown", "none")).toBe(false);
    expect(isAllowedPair("classic", "unknown")).toBe(false);
    expect(EFFECTS.some(({ id }) => id === "flip")).toBe(true);
    expect(getAllowedEffects("classic").every(({ id }) => isAllowedPair("classic", id))).toBe(true);
  });
});

describe("appearance preference safety", () => {
  it("keeps only safe global and panel values", () => {
    const value = sanitizeAppearance({
      global_skin_id: "marble",
      global_effect_id: "tilt",
      panel_overrides: {
        [PANEL_IDS.dashboardKpis]: { skinId: "carbon", effectId: "lift" },
        [PANEL_IDS.financeSummary]: { skinId: "not-a-skin", effectId: "none" },
        injected: { skinId: "classic", effectId: "none" },
      },
      self_transfer_names: ["Даниил В. Е.", "Даниил В. Е.", "x"],
    });

    expect(value).toEqual({
      skinId: "marble",
      effectId: "tilt",
      panelOverrides: {
        [PANEL_IDS.dashboardKpis]: { skinId: "carbon", effectId: "lift" },
      },
      selfTransferNames: ["Даниил В. Е."],
    });
  });

  it("falls back when persisted values are missing or incompatible", () => {
    expect(sanitizeAppearance({ global_skin_id: "classic", global_effect_id: "tilt" }))
      .toEqual(DEFAULT_APPEARANCE);
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it("resolves a valid panel override and otherwise inherits the global pair", () => {
    const preference = {
      skinId: "classic",
      effectId: "none",
      panelOverrides: {
        [PANEL_IDS.tasksBoard]: { skinId: "dust", effectId: "pulse" },
      },
    };
    expect(resolvePanelAppearance(preference, PANEL_IDS.tasksBoard))
      .toEqual({ skinId: "dust", effectId: "pulse", inherited: false });
    expect(resolvePanelAppearance(preference, PANEL_IDS.projectsList))
      .toEqual({ skinId: "classic", effectId: "none", inherited: true });
  });

  it("round-trips database and local cache data through the safe shape", () => {
    const raw = {
      global_skin_id: "data",
      global_effect_id: "spark",
      panel_overrides: { [PANEL_IDS.financeSummary]: { skinId: "ingot", effectId: "lift" } },
      self_transfer_names: ["Даниил В. Е."],
    };
    expect(deserializeAppearance(serializeAppearance(deserializeAppearance(raw))))
      .toEqual(deserializeAppearance(raw));
  });

  it("changes and resets global or one supported area without accepting invalid input", () => {
    const global = withGlobalAppearance(DEFAULT_APPEARANCE, { skinId: "data", effectId: "spark" });
    const custom = withPanelOverride(global, PANEL_IDS.financeSummary, { skinId: "ingot", effectId: "lift" });
    expect(resolvePanelAppearance(custom, PANEL_IDS.financeSummary)).toEqual({ skinId: "ingot", effectId: "lift", inherited: false });
    expect(withoutPanelOverride(custom, PANEL_IDS.financeSummary)).toEqual({ ...global, selfTransferNames: [] });
    expect(withGlobalAppearance(global, { skinId: "classic", effectId: "tilt" })).toEqual(global);
    expect(resetAppearance()).toEqual(DEFAULT_APPEARANCE);
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppearancePanel from "./AppearancePanel.jsx";

describe("AppearancePanel", () => {
  it("decorates the existing surface without adding a layout wrapper", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AppearancePanel,
        {
          panelId: "dashboard.kpis",
          appearance: { skinId: "carbon", effectId: "lift", panelOverrides: {} },
        },
        React.createElement("article", { className: "existing-card" }, "Контент"),
      ),
    );

    expect(html).toContain('class="existing-card kp-appearance-surface');
    expect(html).toContain("kp-skin-carbon");
    expect(html).toContain("kp-effect-lift");
    expect(html).not.toContain("<section");
    expect(html).not.toContain("kp-appearance-panel-body");
  });
});

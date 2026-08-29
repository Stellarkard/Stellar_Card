import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "./Button";
import { Input } from "./Input";
import { Toggle } from "./Toggle";

describe("shared dashboard ui components", () => {
  it("derives a button aria-label from string children and hides decorative icons", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, {
        variant: "primary",
        icon: createElement("svg", { viewBox: "0 0 10 10" }),
        children: "Save changes",
      }),
    );

    expect(markup).toContain('aria-label="Save changes"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Save changes");
    expect(markup).toContain("var(--green-muted)");
  });

  it("renders input accessibility props and decorative slots", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, {
        "aria-label": "Amount",
        "aria-describedby": "amount-help",
        "aria-invalid": true,
        "aria-required": true,
        defaultValue: "25",
        prefix: createElement("span", null, "$"),
        suffix: createElement("span", null, "USD"),
      }),
    );

    expect(markup).toContain('aria-label="Amount"');
    expect(markup).toContain('aria-describedby="amount-help"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-required="true"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("var(--red)");
    expect(markup).toContain("USD");
  });

  it("renders toggle switch semantics, description, and inline child content", () => {
    const markup = renderToStaticMarkup(
      createElement(Toggle, {
        checked: true,
        onChange: () => {},
        label: "Auto reload",
        description: "Refreshes the dashboard automatically",
        children: createElement("span", null, "Every 5 minutes"),
      }),
    );

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-label="Auto reload"');
    expect(markup).toContain("Refreshes the dashboard automatically");
    expect(markup).toContain("Every 5 minutes");
    expect(markup).toContain("var(--green-dim)");
  });
});

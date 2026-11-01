import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCapabilities, useCapabilities } from "@/lib/use-capabilities";

function DeviceNote() {
  return createElement("p", null, useCapabilities().devices.unavailableReason ?? "");
}

describe("capabilities before the deployment answers (D104)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("first render says it is checking, not what the public server runs on", () => {
    // Server rendering runs no effects, so this is exactly the first paint.
    const html = renderToString(createElement(DeviceNote));
    expect(html).toContain("Checking this deployment");
    expect(html).not.toMatch(/public server|vCPU/);
  });

  it("an unreachable deployment is reported as unreachable, not as the hosted one", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const caps = await loadCapabilities();
    expect(caps.devices.available).toEqual(["cpu"]);
    expect(caps.devices.unavailableReason).toMatch(/could not reach/i);
    expect(caps.devices.unavailableReason).not.toMatch(/public server|vCPU/);
  });
});

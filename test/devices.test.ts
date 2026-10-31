import { describe, expect, it } from "vitest";
import { capabilitiesFrom, deviceChoices, HOSTED_DEFAULT } from "@/lib/use-capabilities";

// ADR-0031: the UI offers only devices the deployment reports as usable, and
// says why CUDA is missing instead of offering it and running on CPU (D33).
describe("device capabilities", () => {
  it("assumes the CPU-only public profile until the server answers", () => {
    expect(HOSTED_DEFAULT.devices.available).toEqual(["cpu"]);
    expect(HOSTED_DEFAULT.devices.unavailableReason).toMatch(/CPU-only/);
  });

  it("reads the devices a local server reports", () => {
    const caps = capabilitiesFrom({
      profile: "local",
      customModels: false,
      limits: {},
      devices: { available: ["cpu", "cuda"], unavailableReason: null, cuda: { available: true, name: "GPU" } },
    });
    expect(caps.devices.available).toEqual(["cpu", "cuda"]);
    expect(caps.devices.unavailableReason).toBeNull();
  });

  it("never invents a device from a malformed or missing report", () => {
    for (const devices of [undefined, null, { available: ["tpu", "cuda", 3] }, { available: "cuda" }]) {
      const caps = capabilitiesFrom({ profile: "local", customModels: false, limits: {}, devices });
      expect(caps.devices.available).toEqual(["cpu"]);
      expect(caps.devices.unavailableReason).toBeTruthy();
    }
  });

  it("offers CUDA only when it is usable, otherwise disabled with the reason", () => {
    expect(deviceChoices(HOSTED_DEFAULT)).toEqual([
      { value: "cpu", label: "CPU", disabled: false },
      { value: "cuda", label: "CUDA (GPU)", disabled: true },
    ]);
    const local = capabilitiesFrom({
      profile: "local",
      customModels: false,
      limits: {},
      devices: { available: ["cpu", "cuda"], unavailableReason: null },
    });
    expect(deviceChoices(local).map((c) => c.disabled)).toEqual([false, false]);
  });
});

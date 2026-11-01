"use client";

/**
 * What the deployment behind this page will compute: its profile, whether it
 * accepts custom checkpoints, its caps, and the devices it can actually run
 * on. Read once per page load from GET /api/calculate, which answers from the
 * same contract the backend enforces. Until it answers, the UI assumes the
 * stricter hosted profile, so it never offers something the server would refuse.
 */

import { useEffect, useState } from "react";
import {
  deviceReportFrom,
  profile,
  profileDeviceReport,
  type Device,
  type DeviceReport,
  type Profile,
  type ProfileName,
} from "@/lib/contract";

export interface Capabilities {
  profile: ProfileName;
  customModels: boolean;
  limits: Omit<Profile, "description">;
  devices: DeviceReport;
}

export const HOSTED_DEFAULT: Capabilities = {
  profile: "hosted",
  customModels: false,
  limits: profile("hosted"),
  devices: profileDeviceReport("hosted"),
};

/**
 * Until this deployment answers, run with the strictest (hosted) limits but say
 * nothing about hardware: a local page must not first describe the public server
 * (D104). The same holds when the deployment cannot be reached at all.
 */
const PENDING: Capabilities = {
  ...HOSTED_DEFAULT,
  devices: { available: ["cpu"], unavailableReason: "Checking this deployment…" },
};

const UNREACHABLE: Capabilities = {
  ...HOSTED_DEFAULT,
  devices: {
    available: ["cpu"],
    unavailableReason: "Could not reach this deployment to ask which devices it can use.",
  },
};

/** Map a GET /api/calculate payload onto Capabilities, trusting nothing in it. */
export function capabilitiesFrom(d: Record<string, unknown>): Capabilities {
  const name: ProfileName = d.profile === "local" ? "local" : "hosted";
  return {
    profile: name,
    customModels: d.customModels === true,
    limits: { ...HOSTED_DEFAULT.limits, ...(d.limits as object) },
    devices: deviceReportFrom(d.devices, "The server did not report which devices it can use."),
  };
}

export interface DeviceChoice {
  value: Device;
  label: string;
  disabled: boolean;
}

/**
 * The Device selector's options (ADR-0031). CUDA is always listed, so a user
 * looking for it finds it, but it is selectable only when the deployment
 * reports it usable; otherwise the panel shows `devices.unavailableReason`.
 */
export function deviceChoices(caps: Capabilities): DeviceChoice[] {
  return [
    { value: "cpu", label: "CPU", disabled: false },
    { value: "cuda", label: "CUDA (GPU)", disabled: !caps.devices.available.includes("cuda") },
  ];
}

let cached: Promise<Capabilities> | null = null;

export function loadCapabilities(): Promise<Capabilities> {
  cached ??= fetch("/api/calculate")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(capabilitiesFrom)
    .catch(() => {
      cached = null;
      return UNREACHABLE;
    });
  return cached;
}

export function useCapabilities(): Capabilities {
  const [caps, setCaps] = useState<Capabilities>(PENDING);
  useEffect(() => {
    let live = true;
    loadCapabilities().then((c) => live && setCaps(c));
    return () => {
      live = false;
    };
  }, []);
  return caps;
}

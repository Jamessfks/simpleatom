"use client";

/**
 * What the deployment behind this page will compute: its profile, whether it
 * accepts custom checkpoints, and its caps. Read once per page load from
 * GET /api/calculate, which answers from the same contract the backend
 * enforces. Until it answers, the UI assumes the stricter hosted profile, so
 * it never offers something the server would refuse.
 */

import { useEffect, useState } from "react";
import { profile, type Profile, type ProfileName } from "@/lib/contract";

export interface Capabilities {
  profile: ProfileName;
  customModels: boolean;
  limits: Omit<Profile, "description">;
}

const HOSTED_DEFAULT: Capabilities = {
  profile: "hosted",
  customModels: false,
  limits: profile("hosted"),
};

let cached: Promise<Capabilities> | null = null;

function loadCapabilities(): Promise<Capabilities> {
  cached ??= fetch("/api/calculate")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d) => ({
      profile: d.profile === "local" ? "local" : "hosted",
      customModels: d.customModels === true,
      limits: { ...HOSTED_DEFAULT.limits, ...d.limits },
    }) as Capabilities)
    .catch(() => {
      cached = null;
      return HOSTED_DEFAULT;
    });
  return cached;
}

export function useCapabilities(): Capabilities {
  const [caps, setCaps] = useState<Capabilities>(HOSTED_DEFAULT);
  useEffect(() => {
    let live = true;
    loadCapabilities().then((c) => live && setCaps(c));
    return () => {
      live = false;
    };
  }, []);
  return caps;
}

"use client";

import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
};

export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => true,
  );
}

export function toggleTheme() {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("receipts:theme", dark ? "dark" : "light");
  } catch {
    /* ignore */
  }
}

/** SVG presentation attributes can't use CSS variables, so charts get concrete colors. */
export function useChartColors() {
  const dark = useIsDark();
  return dark
    ? { grid: "#1c2027", axis: "#5d6572", text: "#9199a6", panel: "#111419", border: "#232830", fg: "#e7e9ec" }
    : { grid: "#e8ebef", axis: "#9aa2af", text: "#5f6877", panel: "#ffffff", border: "#e3e6eb", fg: "#14171c" };
}

export const SERIES_COLORS = ["#7c93ff", "#34d399", "#f59e0b", "#f472b6", "#22d3ee", "#a78bfa", "#fb7185", "#a3e635"];

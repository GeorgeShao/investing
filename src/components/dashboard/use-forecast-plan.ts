"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_FORECAST_PLAN,
  loadForecastPlan,
  saveForecastPlan,
  sanitizeForecastPlan,
  type ForecastPlanPrefs,
} from "@/lib/forecast-plan";

let snapshot = DEFAULT_FORECAST_PLAN;
let didLoad = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function getClientSnapshot(): ForecastPlanPrefs {
  if (!didLoad) {
    didLoad = true;
    snapshot = loadForecastPlan();
  }
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Persist forecast contribution, end-date, inflation, and goal prefs.
 * Server / first paint uses defaults; localStorage applies after hydrate.
 */
export function useForecastPlanPrefs(): [
  ForecastPlanPrefs,
  (patch: Partial<ForecastPlanPrefs>) => void,
] {
  const plan = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    () => DEFAULT_FORECAST_PLAN,
  );
  const update = useCallback((patch: Partial<ForecastPlanPrefs>) => {
    snapshot = sanitizeForecastPlan({ ...getClientSnapshot(), ...patch });
    saveForecastPlan(snapshot);
    emit();
  }, []);
  return [plan, update];
}

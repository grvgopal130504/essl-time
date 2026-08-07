import { useCallback, useState } from "react";
import { ALL_DEVICES, loadDeviceFilter, saveDeviceFilter } from "../lib/deviceFilter.js";

/**
 * Device selection backed by localStorage, so a tab reopens on the same device.
 * The initialiser runs once — reading storage on every render would be wasteful
 * and would fight with the setter.
 */
export function useDeviceFilter(storageKey) {
  const [device, setDeviceState] = useState(() => loadDeviceFilter(storageKey));

  const setDevice = useCallback(
    (sn) => {
      const next = sn || ALL_DEVICES;
      setDeviceState(next);
      saveDeviceFilter(storageKey, next);
    },
    [storageKey]
  );

  return [device, setDevice];
}

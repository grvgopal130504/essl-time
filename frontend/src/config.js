/**
 * Local dev  : leave these unset. Vite proxies /api and /ws to localhost:8081.
 * Static Web Apps : set VITE_API_BASE to your App Service URL at build time, e.g.
 *                   VITE_API_BASE=https://essl-adms.azurewebsites.net
 */
const RAW_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

export const API_BASE = RAW_BASE;

export const WS_URL = RAW_BASE
  ? `${RAW_BASE.replace(/^http/, "ws")}/ws`
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export const api = (path) => `${API_BASE}${path}`;

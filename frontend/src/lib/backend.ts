export type BackendStatus = "checking" | "ready" | "unconfigured" | "unavailable";

/**
 * A backend URL relative to the page. FastAPI serves the page and the API
 * together, so this keeps both under whatever prefix the app is mounted at.
 */
export function backendUrl(path: "agent" | "health", base = document.baseURI): string {
  return new URL(path, base).toString();
}

export async function getBackendStatus(base?: string): Promise<BackendStatus> {
  try {
    const response = await fetch(backendUrl("health", base), {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return "unavailable";
    const health = await response.json();
    if (health?.status !== "ok" || typeof health.configured !== "boolean") return "unavailable";
    return health.configured ? "ready" : "unconfigured";
  } catch {
    return "unavailable";
  }
}

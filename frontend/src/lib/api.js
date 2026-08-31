/**
 * Resolve the backend API prefix.
 *
 * Same-origin deployments (nginx serving UI + /api) must use a relative `/api`
 * path. Absolute URLs to the configured hostname force a fresh DNS lookup and
 * can fail in Safari ("A server with the specified hostname could not be found")
 * even while the page itself is already loaded from that host.
 */
export const resolveApiBase = (backendUrl, pageOrigin) => {
  const configured = String(backendUrl || "").trim().replace(/\/$/, "");
  if (!configured) return "/api";

  if (pageOrigin) {
    try {
      const configuredOrigin = new URL(configured, `${pageOrigin}/`).origin;
      if (configuredOrigin === pageOrigin) return "/api";
    } catch {
      return "/api";
    }
  }

  return `${configured}/api`;
};

const pageOrigin = typeof window !== "undefined" ? window.location.origin : "";

export const API = resolveApiBase(process.env.REACT_APP_BACKEND_URL, pageOrigin);

export const isRequestCanceled = (error) =>
  Boolean(
    error?.code === "ERR_CANCELED" ||
      error?.name === "CanceledError" ||
      error?.name === "AbortError",
  );

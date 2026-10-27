export const MAX_MONITORS = 10;
export const MAX_NAME_LENGTH = 60;
export const MAX_URL_LENGTH = 2048;
export const CHECK_INTERVAL_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 8_000;
export const MAX_HISTORY = 30;

export function validateMonitorInput(name, value, monitors = []) {
  const normalizedName = typeof name === "string" ? name.trim() : "";
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  if (!normalizedName) {
    return { error: "Enter a name for this monitor." };
  }
  if (normalizedName.length > MAX_NAME_LENGTH) {
    return { error: `Monitor names must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  if (!normalizedValue || normalizedValue.length > MAX_URL_LENGTH) {
    return { error: "Enter a valid URL of 2,048 characters or fewer." };
  }

  let url;
  try {
    url = new URL(normalizedValue);
  } catch {
    return { error: "Enter a valid, absolute endpoint URL." };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { error: "Only HTTP and HTTPS endpoints are supported." };
  }
  if (!url.hostname || url.username || url.password) {
    return { error: "The URL must include a hostname and must not contain credentials." };
  }
  if (url.hash) {
    return { error: "Endpoint URLs must not contain a fragment." };
  }
  if (monitors.length >= MAX_MONITORS) {
    return { error: `You can add up to ${MAX_MONITORS} monitors.` };
  }
  if (monitors.some((monitor) => monitor.url === url.href)) {
    return { error: "That endpoint is already being monitored." };
  }

  return { value: { name: normalizedName, url: url.href } };
}

export async function checkEndpoint(endpoint, {
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const startedAt = now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    const checkedAt = now();
    return {
      status: response.ok ? "up" : "down",
      statusCode: response.status,
      durationMs: Math.max(0, checkedAt - startedAt),
      checkedAt: new Date(checkedAt).toISOString(),
      error: response.ok ? null : `Endpoint returned HTTP ${response.status}.`,
    };
  } catch (error) {
    const checkedAt = now();
    return {
      status: "down",
      statusCode: null,
      durationMs: Math.max(0, checkedAt - startedAt),
      checkedAt: new Date(checkedAt).toISOString(),
      error: error?.name === "AbortError" ? "Request timed out." : "Network or CORS error.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function appendCheck(monitor, result) {
  return {
    ...monitor,
    history: [...(Array.isArray(monitor.history) ? monitor.history : []), result].slice(-MAX_HISTORY),
  };
}

export function getLatestCheck(monitor) {
  return monitor.history?.at(-1) ?? null;
}

export function getUptimePercentage(monitor) {
  const history = monitor.history ?? [];
  if (history.length === 0) return null;
  const successful = history.filter((check) => check.status === "up").length;
  return (successful / history.length) * 100;
}

export function loadMonitors(storage) {
  const stored = storage.getItem("pulse.monitors");
  if (stored === null) return [];

  let monitors;
  try {
    monitors = JSON.parse(stored);
  } catch {
    throw new Error("Saved monitor data is unreadable. Clear this site's stored data to start fresh.");
  }

  if (!Array.isArray(monitors) || monitors.length > MAX_MONITORS) {
    throw new Error("Saved monitor data is invalid. Clear this site's stored data to start fresh.");
  }

  for (const monitor of monitors) {
    if (
      !monitor
      || typeof monitor.id !== "string"
      || typeof monitor.name !== "string"
      || typeof monitor.url !== "string"
      || !Array.isArray(monitor.history)
    ) {
      throw new Error("Saved monitor data is invalid. Clear this site's stored data to start fresh.");
    }
  }

  return monitors;
}

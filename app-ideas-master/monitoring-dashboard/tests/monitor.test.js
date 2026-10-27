import assert from "node:assert/strict";
import test from "node:test";

import {
  appendCheck,
  checkEndpoint,
  getLatestCheck,
  getUptimePercentage,
  loadMonitors,
  MAX_HISTORY,
  MAX_MONITORS,
  validateMonitorInput,
} from "../public/monitor.js";

test("validates and normalizes monitor names and HTTP URLs", () => {
  assert.deepEqual(validateMonitorInput("  Orders API  ", "https://example.com/health"), {
    value: { name: "Orders API", url: "https://example.com/health" },
  });
});

test("rejects missing names and malformed or unsupported URLs", () => {
  assert.match(validateMonitorInput("", "https://example.com").error, /name/i);
  assert.match(validateMonitorInput("API", "/health").error, /absolute/i);
  assert.match(validateMonitorInput("API", "javascript:alert(1)").error, /HTTP and HTTPS/i);
  assert.match(validateMonitorInput("API", "https://user:secret@example.com").error, /credentials/i);
  assert.match(validateMonitorInput("API", "https://example.com/#section").error, /fragment/i);
  assert.match(validateMonitorInput("API", `https://example.com/${"x".repeat(2048)}`).error, /2,048/i);
});

test("enforces monitor limit and duplicate endpoint validation", () => {
  const existing = [{ url: "https://example.com/health" }];
  assert.match(validateMonitorInput("API", existing[0].url, existing).error, /already/i);
  const atCapacity = Array.from({ length: MAX_MONITORS }, (_, index) => ({ url: `https://example.com/${index}` }));
  assert.match(validateMonitorInput("Another API", "https://new.example.com", atCapacity).error, /up to/i);
});

test("records check results and retains only the latest history", () => {
  let monitor = { history: [] };
  for (let index = 0; index < MAX_HISTORY + 2; index += 1) {
    monitor = appendCheck(monitor, { status: index % 2 ? "down" : "up", checkedAt: String(index) });
  }

  assert.equal(monitor.history.length, MAX_HISTORY);
  assert.equal(getLatestCheck(monitor).checkedAt, String(MAX_HISTORY + 1));
  assert.equal(getUptimePercentage(monitor), 50);
  assert.equal(getUptimePercentage({ history: [] }), null);
});

test("returns a successful HTTP check with duration and status code", async () => {
  let time = 100;
  let request;
  const result = await checkEndpoint("https://example.com/health", {
    now: () => { time += 25; return time; },
    fetchImpl: async (_url, options) => {
      request = options;
      return { ok: true, status: 200 };
    },
  });

  assert.equal(result.status, "up");
  assert.equal(result.statusCode, 200);
  assert.equal(result.durationMs, 25);
  assert.equal(request.method, "GET");
  assert.equal(request.credentials, "omit");
  assert.equal(request.cache, "no-store");
  assert.equal(request.mode, "cors");
});

test("marks non-2xx HTTP responses down", async () => {
  const result = await checkEndpoint("https://example.com/health", {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  assert.equal(result.status, "down");
  assert.equal(result.statusCode, 503);
  assert.equal(result.error, "Endpoint returned HTTP 503.");
});

test("reports network errors and timeouts without hiding the failed check", async () => {
  const networkError = await checkEndpoint("https://example.com/health", {
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
  });
  assert.equal(networkError.status, "down");
  assert.match(networkError.error, /Network or CORS/);

  const timeout = await checkEndpoint("https://example.com/health", {
    timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  assert.equal(timeout.status, "down");
  assert.equal(timeout.error, "Request timed out.");
});

test("loads saved monitor data and rejects corrupted storage", () => {
  assert.deepEqual(loadMonitors({ getItem: () => null }), []);
  assert.deepEqual(loadMonitors({
    getItem: () => JSON.stringify([{ id: "1", name: "API", url: "https://example.com", history: [] }]),
  }).length, 1);
  assert.throws(() => loadMonitors({ getItem: () => "{" }), /unreadable/i);
  assert.throws(() => loadMonitors({ getItem: () => JSON.stringify({ id: "1" }) }), /invalid/i);
});

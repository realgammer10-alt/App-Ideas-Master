import {
  appendCheck,
  CHECK_INTERVAL_MS,
  checkEndpoint,
  getLatestCheck,
  getUptimePercentage,
  loadMonitors,
  MAX_HISTORY,
  MAX_MONITORS,
  validateMonitorInput,
} from "/monitor.js";

const elements = {
  totalCount: document.querySelector("#total-count"),
  operationalCount: document.querySelector("#operational-count"),
  attentionCount: document.querySelector("#attention-count"),
  lastChecked: document.querySelector("#last-checked"),
  refreshCaption: document.querySelector("#refresh-caption"),
  monitorBadge: document.querySelector("#monitor-badge"),
  monitorList: document.querySelector("#monitor-list"),
  emptyState: document.querySelector("#empty-state"),
  notice: document.querySelector("#notice"),
  dialog: document.querySelector("#monitor-dialog"),
  form: document.querySelector("#monitor-form"),
  nameInput: document.querySelector("#monitor-name"),
  urlInput: document.querySelector("#monitor-url"),
  formError: document.querySelector("#form-error"),
  addButtons: document.querySelectorAll("#add-monitor-button, #empty-add-button"),
  closeDialogButton: document.querySelector("#close-dialog-button"),
  cancelDialogButton: document.querySelector("#cancel-dialog-button"),
  refreshButton: document.querySelector("#refresh-button"),
};

let monitors = [];
let lastCheckedAt = null;
const inFlight = new Set();
let noticeTimeout;

function showNotice(message, isError = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("notice-error", isError);
  elements.notice.hidden = false;
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => {
    elements.notice.hidden = true;
  }, 5_000);
}

function saveMonitors() {
  try {
    localStorage.setItem("pulse.monitors", JSON.stringify(monitors));
    return true;
  } catch {
    showNotice("Couldn't save your monitors. Check your browser's available storage.", true);
    return false;
  }
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function makeElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderHistory(monitor) {
  const history = makeElement("div", "history-bars");
  history.setAttribute("role", "img");
  const checks = monitor.history.slice(-MAX_HISTORY);
  const label = checks.length
    ? `${checks.filter((check) => check.status === "up").length} successful checks out of ${checks.length}`
    : "No checks recorded yet";
  history.setAttribute("aria-label", label);

  for (const check of checks) {
    const bar = makeElement("span", `history-bar history-${check.status}`);
    bar.title = `${check.status === "up" ? "Available" : "Unavailable"} · ${formatTime(check.checkedAt)}`;
    history.append(bar);
  }
  return history;
}

function renderMonitor(monitor) {
  const latest = getLatestCheck(monitor);
  const isChecking = inFlight.has(monitor.id);
  const article = makeElement("article", `monitor-card${latest?.status === "down" ? " monitor-card-down" : ""}`);

  const identity = makeElement("div", "monitor-identity");
  const icon = makeElement("span", `service-icon${latest?.status === "down" ? " service-icon-down" : ""}`, "↗");
  icon.setAttribute("aria-hidden", "true");
  const nameAndUrl = makeElement("div", "monitor-name-group");
  nameAndUrl.append(makeElement("h3", "monitor-name", monitor.name));
  const link = makeElement("a", "monitor-url", monitor.url);
  link.href = monitor.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  nameAndUrl.append(link);
  identity.append(icon, nameAndUrl);

  const status = makeElement("div", `status-pill ${latest?.status === "up" ? "status-up" : latest?.status === "down" ? "status-down" : "status-pending"}`);
  const statusDot = makeElement("span", "status-dot");
  statusDot.setAttribute("aria-hidden", "true");
  status.append(statusDot, document.createTextNode(isChecking ? "Checking" : latest?.status === "up" ? "Operational" : latest?.status === "down" ? "Down" : "Pending"));

  const responseTime = makeElement("div", "monitor-metric");
  responseTime.append(makeElement("span", "metric-label", "Response"), makeElement("strong", "", latest ? `${latest.durationMs} ms` : "—"));

  const uptime = makeElement("div", "monitor-metric");
  uptime.append(makeElement("span", "metric-label", "Recent uptime"), makeElement("strong", "", getUptimePercentage(monitor) === null ? "—" : `${getUptimePercentage(monitor).toFixed(1)}%`));

  const history = renderHistory(monitor);
  const latestDate = makeElement("div", "monitor-checked", latest ? `Checked ${formatTime(latest.checkedAt)}` : "Waiting for first check");
  const actions = makeElement("div", "monitor-actions");
  const checkButton = makeElement("button", "icon-button", "↻");
  checkButton.type = "button";
  checkButton.title = `Check ${monitor.name} now`;
  checkButton.setAttribute("aria-label", `Check ${monitor.name} now`);
  checkButton.disabled = isChecking;
  checkButton.addEventListener("click", () => checkMonitor(monitor.id));
  const deleteButton = makeElement("button", "icon-button delete-button", "×");
  deleteButton.type = "button";
  deleteButton.title = `Remove ${monitor.name}`;
  deleteButton.setAttribute("aria-label", `Remove ${monitor.name}`);
  deleteButton.addEventListener("click", () => removeMonitor(monitor.id));
  actions.append(checkButton, deleteButton);

  const detail = makeElement("div", "monitor-detail");
  if (latest?.error) detail.append(makeElement("span", "monitor-error", latest.error));

  article.append(identity, status, responseTime, uptime, history, latestDate, actions);
  if (latest?.error) article.append(detail);
  return article;
}

function render() {
  const latestChecks = monitors.map(getLatestCheck);
  const operationalCount = latestChecks.filter((check) => check?.status === "up").length;
  const attentionCount = latestChecks.filter((check) => check?.status === "down").length;

  elements.totalCount.textContent = String(monitors.length);
  elements.operationalCount.textContent = String(operationalCount);
  elements.attentionCount.textContent = String(attentionCount);
  elements.lastChecked.textContent = formatTime(lastCheckedAt);
  elements.monitorBadge.textContent = String(monitors.length);
  elements.emptyState.hidden = monitors.length > 0;
  elements.monitorList.replaceChildren(...monitors.map(renderMonitor));
  elements.refreshButton.disabled = monitors.length === 0 || inFlight.size > 0;
  elements.refreshCaption.textContent = inFlight.size > 0 ? "A check is in progress" : "Automatic checks every minute";
}

function updateMonitor(id, result) {
  monitors = monitors.map((monitor) => monitor.id === id ? appendCheck(monitor, result) : monitor);
  lastCheckedAt = result.checkedAt;
  saveMonitors();
  render();
}

async function checkMonitor(id) {
  const monitor = monitors.find((item) => item.id === id);
  if (!monitor || inFlight.has(id)) return;
  inFlight.add(id);
  render();

  try {
    const result = await checkEndpoint(monitor.url);
    updateMonitor(id, result);
  } finally {
    inFlight.delete(id);
    render();
  }
}

async function checkAllMonitors() {
  if (inFlight.size > 0 || monitors.length === 0) return;
  await Promise.all(monitors.map((monitor) => checkMonitor(monitor.id)));
}

function removeMonitor(id) {
  const monitor = monitors.find((item) => item.id === id);
  if (!monitor) return;
  monitors = monitors.filter((item) => item.id !== id);
  saveMonitors();
  render();
  showNotice(`${monitor.name} was removed.`);
}

function openDialog() {
  if (monitors.length >= MAX_MONITORS) {
    showNotice(`You can add up to ${MAX_MONITORS} monitors.`, true);
    return;
  }
  elements.formError.hidden = true;
  elements.form.reset();
  elements.dialog.showModal();
  elements.nameInput.focus();
}

for (const button of elements.addButtons) {
  button.addEventListener("click", openDialog);
}

elements.closeDialogButton.addEventListener("click", () => elements.dialog.close());
elements.cancelDialogButton.addEventListener("click", () => elements.dialog.close());
elements.refreshButton.addEventListener("click", checkAllMonitors);
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = validateMonitorInput(elements.nameInput.value, elements.urlInput.value, monitors);
  if (result.error) {
    elements.formError.textContent = result.error;
    elements.formError.hidden = false;
    return;
  }

  const monitor = {
    id: crypto.randomUUID(),
    ...result.value,
    createdAt: new Date().toISOString(),
    history: [],
  };
  monitors = [...monitors, monitor];
  saveMonitors();
  render();
  elements.dialog.close();
  showNotice(`${monitor.name} was added. Running the first check now.`);
  void checkMonitor(monitor.id);
});

try {
  monitors = loadMonitors(localStorage);
  render();
  if (monitors.length > 0) void checkAllMonitors();
  setInterval(() => {
    if (document.visibilityState === "visible") void checkAllMonitors();
  }, CHECK_INTERVAL_MS);
} catch (error) {
  showNotice(error.message, true);
  elements.refreshButton.disabled = true;
}

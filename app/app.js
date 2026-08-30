const form = document.getElementById("analyze-form");
const fileInput = document.getElementById("manifest-file");
const statusEl = document.getElementById("status");
const reportEl = document.getElementById("report");

const compareForm = document.getElementById("compare-form");
const previousFileInput = document.getElementById("previous-manifest-file");
const candidateFileInput = document.getElementById("candidate-manifest-file");
const compareStatusEl = document.getElementById("compare-status");
const compareReportEl = document.getElementById("compare-report");

function setStatus(message) {
  statusEl.textContent = message;
}

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.text !== undefined) node.textContent = options.text;
  if (options.className) node.className = options.className;
  for (const child of children) node.appendChild(child);
  return node;
}

function renderLane(lane) {
  const container = el("div", { className: "lane" });
  container.appendChild(el("strong", { text: `${lane.id} (${lane.priority})` }));
  container.appendChild(el("p", { text: lane.reason }));
  const list = el("ul");
  for (const check of lane.checks) list.appendChild(el("li", { text: check }));
  container.appendChild(list);
  return container;
}

function renderFinding(flag) {
  const container = el("div", { className: "finding" });
  container.appendChild(el("strong", { text: `${flag.id} (${flag.level})` }));
  container.appendChild(el("p", { text: flag.message }));
  return container;
}

function renderReport(report) {
  reportEl.textContent = "";
  reportEl.hidden = false;

  reportEl.appendChild(el("h2", { text: "Identity" }));
  reportEl.appendChild(el("p", {
    text: `${report.identity.name} — version ${report.identity.version} (Manifest V${report.identity.manifestVersion})`
  }));

  reportEl.appendChild(el("h2", { text: "Detected surfaces" }));
  const surfaceList = el("ul");
  for (const [key, value] of Object.entries(report.surfaces)) {
    surfaceList.appendChild(el("li", { text: `${key}: ${String(value)}` }));
  }
  reportEl.appendChild(surfaceList);

  reportEl.appendChild(el("h2", { text: "Test lanes" }));
  if (report.lanes.length === 0) {
    reportEl.appendChild(el("p", { text: "No test lanes were derived from this manifest." }));
  } else {
    for (const lane of report.lanes) reportEl.appendChild(renderLane(lane));
  }

  reportEl.appendChild(el("h2", { text: "Findings" }));
  if (report.riskFlags.length === 0) {
    reportEl.appendChild(el("p", { text: "No risk flags were detected in this static analysis." }));
  } else {
    for (const flag of report.riskFlags) reportEl.appendChild(renderFinding(flag));
  }

  reportEl.appendChild(el("h2", { text: "Limitations" }));
  reportEl.appendChild(el("p", {
    text: "This is a static manifest analysis only. The extension has not been loaded, executed, or "
      + "tested in a browser. It does not read extension source files or verify runtime behavior."
  }));
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsText(file);
  });
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  reportEl.hidden = true;
  reportEl.textContent = "";

  const file = fileInput.files[0];
  if (!file) {
    setStatus("Select a local manifest.json file first.");
    return;
  }

  setStatus("Reading local file...");
  let manifest;
  try {
    const text = await readFileAsText(file);
    manifest = JSON.parse(text);
  } catch {
    setStatus("The selected file is not valid JSON.");
    return;
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    setStatus("The selected file must contain a JSON object.");
    return;
  }

  setStatus("Analyzing locally...");
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "The manifest could not be analyzed.");
      return;
    }
    setStatus("Analysis complete.");
    renderReport(data.report);
  } catch {
    setStatus("The local analyzer could not be reached.");
  }
});

function setCompareStatus(message) {
  compareStatusEl.textContent = message;
}

function renderListDiff(title, diff) {
  const container = el("div", { className: "finding" });
  container.appendChild(el("strong", { text: title }));
  container.appendChild(el("p", {
    text: `Added: ${diff.added && diff.added.length ? diff.added.join(", ") : "none"}`
  }));
  container.appendChild(el("p", {
    text: `Removed: ${diff.removed && diff.removed.length ? diff.removed.join(", ") : "none"}`
  }));
  return container;
}

function renderCompareReport(report) {
  compareReportEl.textContent = "";
  compareReportEl.hidden = false;

  compareReportEl.appendChild(el("h2", { text: "Release identity" }));
  compareReportEl.appendChild(el("p", {
    text: `From ${report.from.name} v${report.from.version} to ${report.to.name} v${report.to.version}`
  }));

  compareReportEl.appendChild(el("h2", { text: "Manual update validation" }));
  compareReportEl.appendChild(el("p", {
    text: report.requiresManualUpdateValidation
      ? "This release requires manual update-path validation before it ships."
      : "No critical-level findings were detected, but review the findings below before shipping."
  }));

  compareReportEl.appendChild(el("h2", { text: "Findings" }));
  if (report.findings.length === 0) {
    compareReportEl.appendChild(el("p", { text: "No comparison findings were detected in this static analysis." }));
  } else {
    for (const finding of report.findings) compareReportEl.appendChild(renderFinding(finding));
  }

  compareReportEl.appendChild(el("h2", { text: "Key changes" }));
  compareReportEl.appendChild(renderListDiff("Required permissions", report.changes.requiredPermissions));
  compareReportEl.appendChild(renderListDiff("Optional permissions", report.changes.optionalPermissions));
  compareReportEl.appendChild(renderListDiff("Required host access", report.changes.requiredHosts));
  compareReportEl.appendChild(renderListDiff("Optional host access", report.changes.optionalHosts));
  compareReportEl.appendChild(renderListDiff("Content-script match scope", report.changes.contentScriptMatches));
  compareReportEl.appendChild(renderListDiff("Keyboard commands", report.changes.commands));

  compareReportEl.appendChild(el("h2", { text: "Limitations" }));
  compareReportEl.appendChild(el("p", {
    text: "This is a static comparison of two manifest files only. Neither release has been loaded, "
      + "executed, or tested in a browser. It does not read extension source files or verify runtime behavior."
  }));
}

compareForm.addEventListener("submit", async event => {
  event.preventDefault();
  compareReportEl.hidden = true;
  compareReportEl.textContent = "";

  const previousFile = previousFileInput.files[0];
  const candidateFile = candidateFileInput.files[0];
  if (!previousFile || !candidateFile) {
    setCompareStatus("Select both a previous and a candidate manifest.json file.");
    return;
  }

  setCompareStatus("Reading local files...");
  let previousManifest;
  let currentManifest;
  try {
    const [previousText, candidateText] = await Promise.all([
      readFileAsText(previousFile),
      readFileAsText(candidateFile)
    ]);
    previousManifest = JSON.parse(previousText);
    currentManifest = JSON.parse(candidateText);
  } catch {
    setCompareStatus("Both selected files must be valid JSON.");
    return;
  }

  if (
    !previousManifest || typeof previousManifest !== "object" || Array.isArray(previousManifest)
    || !currentManifest || typeof currentManifest !== "object" || Array.isArray(currentManifest)
  ) {
    setCompareStatus("Both selected files must contain a JSON object.");
    return;
  }

  setCompareStatus("Comparing locally...");
  try {
    const response = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous: previousManifest, current: currentManifest })
    });
    const data = await response.json();
    if (!response.ok) {
      setCompareStatus(data.error || "The manifests could not be compared.");
      return;
    }
    setCompareStatus("Comparison complete.");
    renderCompareReport(data.report);
  } catch {
    setCompareStatus("The local comparison endpoint could not be reached.");
  }
});

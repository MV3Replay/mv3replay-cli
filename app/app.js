const form = document.getElementById("analyze-form");
const fileInput = document.getElementById("manifest-file");
const folderInput = document.getElementById("manifest-folder");
const statusEl = document.getElementById("status");
const reportEl = document.getElementById("report");

const checklistEl = document.getElementById("checklist");
const checklistListEl = document.getElementById("checklist-list");
const checklistProgressEl = document.getElementById("checklist-progress");
const exportButton = document.getElementById("export-checklist");
const exportMarkdownButton = document.getElementById("export-checklist-markdown");
const exportStatusEl = document.getElementById("export-status");

// Checklist state exists only for the lifetime of this page.
let currentReport = null;
let checklistState = [];

const compareForm = document.getElementById("compare-form");
const previousFileInput = document.getElementById("previous-manifest-file");
const previousFolderInput = document.getElementById("previous-manifest-folder");
const candidateFileInput = document.getElementById("candidate-manifest-file");
const candidateFolderInput = document.getElementById("candidate-manifest-folder");
const compareStatusEl = document.getElementById("compare-status");
const compareReportEl = document.getElementById("compare-report");

const candidateChecklistEl = document.getElementById("candidate-checklist");
const candidateChecklistListEl = document.getElementById("candidate-checklist-list");
const candidateChecklistProgressEl = document.getElementById("candidate-checklist-progress");
const exportComparisonButton = document.getElementById("export-comparison");
const exportComparisonMarkdownButton = document.getElementById("export-comparison-markdown");
const exportComparisonStatusEl = document.getElementById("export-comparison-status");

// Candidate checklist state exists only for the lifetime of this page.
let currentCompareReport = null;
let currentCandidateAnalysis = null;
let candidateChecklistState = [];

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

function updateChecklistProgress() {
  const total = checklistState.length;
  const completed = checklistState.filter(item => item.done).length;
  checklistProgressEl.textContent = total === 0
    ? "No checklist items for this manifest."
    : `${completed} of ${total} checklist items completed.`;
}

function renderChecklist(report) {
  checklistListEl.textContent = "";
  checklistState = [];

  report.lanes.forEach((lane, laneIndex) => {
    lane.checks.forEach((check, checkIndex) => {
      const id = `checklist-item-${laneIndex}-${checkIndex}`;
      checklistState.push({ id, laneId: lane.id, check, done: false });

      const item = el("li", { className: "checklist-item" });
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.addEventListener("change", () => {
        const entry = checklistState.find(candidate => candidate.id === id);
        if (entry) entry.done = checkbox.checked;
        updateChecklistProgress();
      });
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = `${lane.id}: ${check}`;

      item.appendChild(checkbox);
      item.appendChild(label);
      checklistListEl.appendChild(item);
    });
  });

  checklistEl.hidden = checklistState.length === 0;
  exportButton.disabled = checklistState.length === 0;
  exportMarkdownButton.disabled = checklistState.length === 0;
  exportStatusEl.textContent = "";
  updateChecklistProgress();
}

function downloadLocalFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildAnalysisMarkdown(report, checklist) {
  const lines = [];
  lines.push("# MV3 Replay analysis report");
  lines.push("");
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Identity");
  lines.push(`- Name: ${report.identity.name}`);
  lines.push(`- Version: ${report.identity.version}`);
  lines.push(`- Manifest version: ${report.identity.manifestVersion}`);
  lines.push("");
  lines.push("## Findings");
  if (report.riskFlags.length === 0) {
    lines.push("No risk flags were detected in this static analysis.");
  } else {
    for (const flag of report.riskFlags) lines.push(`- **${flag.id}** (${flag.level}): ${flag.message}`);
  }
  lines.push("");
  lines.push("## Test checklist");
  if (checklist.length === 0) {
    lines.push("No checklist items for this manifest.");
  } else {
    for (const item of checklist) lines.push(`- [${item.done ? "x" : " "}] ${item.laneId}: ${item.check}`);
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push(
    "This is a static manifest analysis only. The extension has not been loaded, executed, or "
      + "tested in a browser. It does not read extension source files or verify runtime behavior."
  );
  lines.push("");
  return lines.join("\n");
}

exportButton.addEventListener("click", () => {
  if (!currentReport) return;

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    report: currentReport,
    checklist: checklistState.map(({ id, laneId, check, done }) => ({ id, laneId, check, done }))
  };

  downloadLocalFile(
    "mv3-replay-checklist.json",
    JSON.stringify(exportPayload, null, 2),
    "application/json"
  );

  exportStatusEl.textContent = "Checklist exported to a local JSON file.";
});

exportMarkdownButton.addEventListener("click", () => {
  if (!currentReport) return;

  const markdown = buildAnalysisMarkdown(currentReport, checklistState);
  downloadLocalFile("mv3-replay-checklist.md", markdown, "text/markdown");

  exportStatusEl.textContent = "Checklist exported to a local Markdown file.";
});

// Given a FileList from a webkitdirectory input, locate exactly one root
// manifest.json (folderName/manifest.json). Relative paths are inspected only
// to locate it; only this single File object's contents may be read later.
function findRootManifestInFolder(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) {
    return { file: null, error: null };
  }

  const rootManifests = files.filter(file => {
    const relativePath = file.webkitRelativePath || "";
    const segments = relativePath.split("/").filter(Boolean);
    return segments.length === 2 && segments[1] === "manifest.json";
  });

  if (rootManifests.length === 0) {
    return { file: null, error: "The selected folder must contain a root manifest.json file." };
  }
  if (rootManifests.length > 1) {
    return {
      file: null,
      error: "The selected folder has more than one root manifest.json file; the selection is ambiguous."
    };
  }
  return { file: rootManifests[0], error: null };
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
  checklistEl.hidden = true;
  checklistListEl.textContent = "";
  checklistProgressEl.textContent = "";
  exportStatusEl.textContent = "";
  exportButton.disabled = true;
  exportMarkdownButton.disabled = true;
  currentReport = null;
  checklistState = [];

  let file = fileInput.files[0];
  if (!file && folderInput.files.length > 0) {
    const { file: folderManifest, error } = findRootManifestInFolder(folderInput.files);
    if (error) {
      setStatus(error);
      return;
    }
    file = folderManifest;
  }
  if (!file) {
    setStatus("Select a local manifest.json file or an unpacked extension folder first.");
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
    currentReport = data.report;
    renderReport(data.report);
    renderChecklist(data.report);
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

function updateCandidateChecklistProgress() {
  const total = candidateChecklistState.length;
  const completed = candidateChecklistState.filter(item => item.done).length;
  candidateChecklistProgressEl.textContent = total === 0
    ? "No candidate-release checklist items for this comparison."
    : `${completed} of ${total} candidate-release checklist items completed.`;
}

function renderCandidateChecklist(candidateAnalysis) {
  candidateChecklistListEl.textContent = "";
  candidateChecklistState = [];

  candidateAnalysis.lanes.forEach((lane, laneIndex) => {
    lane.checks.forEach((check, checkIndex) => {
      const id = `candidate-checklist-item-${laneIndex}-${checkIndex}`;
      candidateChecklistState.push({ id, laneId: lane.id, check, done: false });

      const item = el("li", { className: "checklist-item" });
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.addEventListener("change", () => {
        const entry = candidateChecklistState.find(candidate => candidate.id === id);
        if (entry) entry.done = checkbox.checked;
        updateCandidateChecklistProgress();
      });
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = `${lane.id}: ${check}`;

      item.appendChild(checkbox);
      item.appendChild(label);
      candidateChecklistListEl.appendChild(item);
    });
  });

  candidateChecklistEl.hidden = candidateChecklistState.length === 0;
  exportComparisonButton.disabled = candidateChecklistState.length === 0;
  exportComparisonMarkdownButton.disabled = candidateChecklistState.length === 0;
  exportComparisonStatusEl.textContent = "";
  updateCandidateChecklistProgress();
}

function buildComparisonMarkdown(report, checklist) {
  const lines = [];
  lines.push("# MV3 Replay comparison report");
  lines.push("");
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Release identity");
  lines.push(`- From: ${report.from.name} v${report.from.version}`);
  lines.push(`- To: ${report.to.name} v${report.to.version}`);
  lines.push("");
  lines.push("## Manual update validation");
  lines.push(
    report.requiresManualUpdateValidation
      ? "This release requires manual update-path validation before it ships."
      : "No critical-level findings were detected, but review the findings below before shipping."
  );
  lines.push("");
  lines.push("## Findings");
  if (report.findings.length === 0) {
    lines.push("No comparison findings were detected in this static analysis.");
  } else {
    for (const finding of report.findings) lines.push(`- **${finding.id}** (${finding.level}): ${finding.message}`);
  }
  lines.push("");
  lines.push("## Key changes");
  const changeTitles = [
    ["requiredPermissions", "Required permissions"],
    ["optionalPermissions", "Optional permissions"],
    ["requiredHosts", "Required host access"],
    ["optionalHosts", "Optional host access"],
    ["contentScriptMatches", "Content-script match scope"],
    ["commands", "Keyboard commands"]
  ];
  for (const [key, title] of changeTitles) {
    const diff = report.changes[key];
    const added = diff && diff.added && diff.added.length ? diff.added.join(", ") : "none";
    const removed = diff && diff.removed && diff.removed.length ? diff.removed.join(", ") : "none";
    lines.push(`- ${title} — Added: ${added}; Removed: ${removed}`);
  }
  lines.push("");
  lines.push("## Candidate-release checklist");
  if (checklist.length === 0) {
    lines.push("No candidate-release checklist items for this comparison.");
  } else {
    for (const item of checklist) lines.push(`- [${item.done ? "x" : " "}] ${item.laneId}: ${item.check}`);
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push(
    "This is a static comparison of two manifest files only. Neither release has been loaded, "
      + "executed, or tested in a browser. It does not read extension source files or verify runtime behavior."
  );
  lines.push("");
  return lines.join("\n");
}

exportComparisonButton.addEventListener("click", () => {
  if (!currentCompareReport || !currentCandidateAnalysis) return;

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    comparisonReport: currentCompareReport,
    candidateAnalysis: currentCandidateAnalysis,
    candidateChecklist: candidateChecklistState.map(({ id, laneId, check, done }) => ({ id, laneId, check, done }))
  };

  downloadLocalFile(
    "mv3-replay-comparison-checklist.json",
    JSON.stringify(exportPayload, null, 2),
    "application/json"
  );

  exportComparisonStatusEl.textContent = "Comparison and candidate checklist exported to a local JSON file.";
});

exportComparisonMarkdownButton.addEventListener("click", () => {
  if (!currentCompareReport || !currentCandidateAnalysis) return;

  const markdown = buildComparisonMarkdown(currentCompareReport, candidateChecklistState);
  downloadLocalFile("mv3-replay-comparison-checklist.md", markdown, "text/markdown");

  exportComparisonStatusEl.textContent = "Comparison and candidate checklist exported to a local Markdown file.";
});

compareForm.addEventListener("submit", async event => {
  event.preventDefault();
  compareReportEl.hidden = true;
  compareReportEl.textContent = "";
  candidateChecklistEl.hidden = true;
  candidateChecklistListEl.textContent = "";
  candidateChecklistProgressEl.textContent = "";
  exportComparisonStatusEl.textContent = "";
  exportComparisonButton.disabled = true;
  exportComparisonMarkdownButton.disabled = true;
  currentCompareReport = null;
  currentCandidateAnalysis = null;
  candidateChecklistState = [];

  let previousFile = previousFileInput.files[0];
  if (!previousFile && previousFolderInput.files.length > 0) {
    const { file: folderManifest, error } = findRootManifestInFolder(previousFolderInput.files);
    if (error) {
      setCompareStatus(`Previous release: ${error}`);
      return;
    }
    previousFile = folderManifest;
  }

  let candidateFile = candidateFileInput.files[0];
  if (!candidateFile && candidateFolderInput.files.length > 0) {
    const { file: folderManifest, error } = findRootManifestInFolder(candidateFolderInput.files);
    if (error) {
      setCompareStatus(`Candidate release: ${error}`);
      return;
    }
    candidateFile = folderManifest;
  }

  if (!previousFile || !candidateFile) {
    setCompareStatus("Select both a previous and a candidate manifest.json file or folder.");
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
    currentCompareReport = data.report;
    currentCandidateAnalysis = data.candidateAnalysis;
    renderCompareReport(data.report);
    renderCandidateChecklist(data.candidateAnalysis);
  } catch {
    setCompareStatus("The local comparison endpoint could not be reached.");
  }
});

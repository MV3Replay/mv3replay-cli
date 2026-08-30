const form = document.getElementById("analyze-form");
const fileInput = document.getElementById("manifest-file");
const statusEl = document.getElementById("status");
const reportEl = document.getElementById("report");

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

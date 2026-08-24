import {
  collectFrameworks,
  createSiteCardElement,
  fetchAllListedSites,
  filterSites,
} from "./sites.js";

const state = {
  sites: [],
  search: "",
  framework: "",
  byaFilter: "all",
};

const elements = {
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  empty: document.getElementById("empty"),
  results: document.getElementById("results"),
  resultCount: document.getElementById("result-count"),
  search: document.getElementById("search"),
  framework: document.getElementById("framework-filter"),
  bya: document.getElementById("bya-filter"),
};

function setView(mode) {
  elements.loading.hidden = mode !== "loading";
  elements.error.hidden = mode !== "error";
  elements.empty.hidden = mode !== "empty";
  elements.results.hidden = mode !== "results";
}

function currentFilters() {
  return {
    search: state.search,
    framework: state.framework,
    byaFilter: state.byaFilter,
  };
}

function renderResults() {
  const filtered = filterSites(state.sites, currentFilters());
  elements.resultCount.textContent = `${filtered.length} listed site${filtered.length === 1 ? "" : "s"}`;

  elements.results.replaceChildren();
  for (const site of filtered) {
    elements.results.appendChild(createSiteCardElement(site));
  }

  if (state.sites.length === 0) {
    setView("empty");
    return;
  }

  if (filtered.length === 0) {
    setView("empty");
    elements.empty.textContent = "No sites match your filters.";
    return;
  }

  setView("results");
}

function populateFrameworkFilter(sites) {
  const frameworks = collectFrameworks(sites);
  elements.framework.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All frameworks";
  elements.framework.appendChild(allOption);

  for (const framework of frameworks) {
    const option = document.createElement("option");
    option.value = framework;
    option.textContent = framework;
    elements.framework.appendChild(option);
  }
}

function wireControls() {
  elements.search.addEventListener("input", () => {
    state.search = elements.search.value;
    renderResults();
  });

  elements.framework.addEventListener("change", () => {
    state.framework = elements.framework.value;
    renderResults();
  });

  elements.bya.addEventListener("change", () => {
    state.byaFilter = elements.bya.value;
    renderResults();
  });
}

async function init() {
  setView("loading");
  wireControls();

  try {
    state.sites = await fetchAllListedSites();
    populateFrameworkFilter(state.sites);
    renderResults();
  } catch (error) {
    console.error(error);
    elements.error.textContent =
      error instanceof Error ? error.message : "Unable to load the site directory.";
    setView("error");
  }
}

init();

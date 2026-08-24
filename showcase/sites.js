/** @typedef {import('./types.js').PublicListItem} PublicListItem */
/** @typedef {import('./types.js').PublicListResponse} PublicListResponse */

export const PAGE_LIMIT = 100;
export const MAX_PAGES = 50;

/**
 * Fetch all LISTED sites from the public API, merging paginated responses.
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [fetchFn]
 * @param {string} [baseUrl]
 * @returns {Promise<PublicListItem[]>}
 */
export async function fetchAllListedSites(fetchFn = fetch, baseUrl) {
  const origin =
    baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  const sites = [];
  let cursor = null;
  let page = 0;

  while (page < MAX_PAGES) {
    const url = new URL("/api/v1/sites", origin);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetchFn(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to load sites (${response.status})`);
    }

    /** @type {PublicListResponse} */
    const body = await response.json();
    sites.push(...body.items);
    cursor = body.nextCursor;
    page += 1;

    if (!cursor) {
      break;
    }
  }

  if (page >= MAX_PAGES && cursor) {
    throw new Error("Site list exceeded maximum pagination depth");
  }

  return sites;
}

/**
 * @param {PublicListItem[]} sites
 * @param {{ search?: string, framework?: string, byaFilter?: 'all' | 'yes' | 'no' }} filters
 * @returns {PublicListItem[]}
 */
export function filterSites(sites, filters = {}) {
  const search = (filters.search ?? "").trim().toLowerCase();
  const framework = filters.framework ?? "";
  const byaFilter = filters.byaFilter ?? "all";

  return sites.filter((site) => {
    if (search && !site.displayName.toLowerCase().includes(search)) {
      return false;
    }

    if (framework) {
      const siteFramework = site.hints?.framework ?? "";
      if (siteFramework !== framework) {
        return false;
      }
    }

    if (byaFilter === "yes") {
      if (site.hints?.byaEnabled !== true) {
        return false;
      }
    } else if (byaFilter === "no") {
      if (site.hints?.byaEnabled !== false) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Collect unique framework hint values for filter options.
 * @param {PublicListItem[]} sites
 * @returns {string[]}
 */
export function collectFrameworks(sites) {
  const frameworks = new Set();
  for (const site of sites) {
    const framework = site.hints?.framework;
    if (framework) {
      frameworks.add(framework);
    }
  }
  return [...frameworks].sort((a, b) => a.localeCompare(b));
}

/**
 * Build a site card using DOM APIs only (no innerHTML for untrusted data).
 * @param {PublicListItem} site
 * @param {Document} doc
 * @returns {HTMLElement}
 */
export function createSiteCardElement(site, doc = document) {
  const card = doc.createElement("article");
  card.className = "site-card";

  const title = doc.createElement("h2");
  title.className = "site-card__title";
  title.textContent = site.displayName;
  card.appendChild(title);

  const link = doc.createElement("a");
  link.className = "site-card__url";
  link.href = site.canonicalUrl;
  link.rel = "noopener noreferrer";
  link.target = "_blank";
  link.textContent = site.canonicalUrl;
  card.appendChild(link);

  const meta = doc.createElement("dl");
  meta.className = "site-card__meta";

  const coreVersion = site.packages["@thierry-gilgen-ict/engawa-core"];
  appendMetaRow(doc, meta, "Engawa core", coreVersion);

  if (site.hints?.framework) {
    appendMetaRow(doc, meta, "Framework", site.hints.framework);
  }

  if (site.hints?.byaEnabled === true) {
    appendMetaRow(doc, meta, "Bring Your Agent", "Enabled");
  } else if (site.hints?.byaEnabled === false) {
    appendMetaRow(doc, meta, "Bring Your Agent", "Not enabled");
  }

  if (site.hints?.localeCount != null) {
    appendMetaRow(doc, meta, "Locales", String(site.hints.localeCount));
  }

  card.appendChild(meta);
  return card;
}

/**
 * @param {Document} doc
 * @param {HTMLElement} container
 * @param {string} label
 * @param {string} value
 */
function appendMetaRow(doc, container, label, value) {
  const dt = doc.createElement("dt");
  dt.textContent = label;
  container.appendChild(dt);

  const dd = doc.createElement("dd");
  dd.textContent = value;
  container.appendChild(dd);
}

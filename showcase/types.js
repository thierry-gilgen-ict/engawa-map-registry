/**
 * @typedef {Object} MapHints
 * @property {string} [framework]
 * @property {boolean} [byaEnabled]
 * @property {number} [localeCount]
 */

/**
 * @typedef {Object} EngawaPackages
 * @property {string} ['@thierry-gilgen-ict/engawa-core']
 * @property {string} ['@thierry-gilgen-ict/engawa-discovery']
 * @property {string} ['@thierry-gilgen-ict/engawa-mcp']
 * @property {string} ['@thierry-gilgen-ict/engawa-react']
 */

/**
 * @typedef {Object} PublicListItem
 * @property {string} siteId
 * @property {string} displayName
 * @property {string} canonicalUrl
 * @property {EngawaPackages} packages
 * @property {MapHints} [hints]
 * @property {string} listedAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} PublicListResponse
 * @property {PublicListItem[]} items
 * @property {string | null} nextCursor
 */

export {};

import { loadConfig } from "../config.js";
import { createPool, runMigrations, withTransaction } from "../db/pool.js";
import { approveSite, adminDelistSite } from "../services/mutations.js";
import { validateSiteId } from "../security/token.js";
import { AppError } from "../errors.js";

async function main(): Promise<void> {
  process.env.NODE_ENV ??= "development";

  const [, , command, siteId] = process.argv;

  if (!command || !siteId) {
    console.error("Usage: pnpm admin <approve|delist> <siteId>");
    process.exit(1);
  }

  if (!validateSiteId(siteId)) {
    console.error("Invalid siteId format.");
    process.exit(1);
  }

  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  await runMigrations(pool);

  try {
    if (command === "approve") {
      await withTransaction(pool, async (client) => {
        const site = await approveSite(client, siteId);
        console.log(`Approved site ${site.id} (state=${site.state})`);
      });
    } else if (command === "delist") {
      await withTransaction(pool, async (client) => {
        await adminDelistSite(client, siteId);
        console.log(`Delisted site ${siteId}`);
      });
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof AppError) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      console.error("Admin command failed.");
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void main();

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createPool, runMigrations } from "../src/db/pool.js";
import { buildApp } from "../src/app.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://engawa_registry:engawa_registry@127.0.0.1:5436/engawa_registry";

const engawaRoot = process.env.ENGAWA_ROOT ?? resolve("..", "engawa");

async function waitForReady(port: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Registry did not become ready");
}

async function main(): Promise<void> {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;

  const pool = createPool(databaseUrl);
  await runMigrations(pool);
  await pool.query("DELETE FROM idempotency_keys");
  await pool.query("DELETE FROM sites");

  const port = 3100 + Math.floor(Math.random() * 500);
  const { app } = buildApp({ pool, logger: false });
  await app.listen({ host: "127.0.0.1", port });
  await waitForReady(port);

  const workDir = await mkdtemp(join(tmpdir(), "engawa-map-e2e-"));
  const configPath = join(workDir, "engawa-map.config.json");
  const canonicalUrl = `https://e2e-${Date.now()}.example.com`;

  await writeFile(
    configPath,
    JSON.stringify(
      {
        displayName: "E2E Example",
        canonicalUrl,
        hints: { framework: "nextjs", byaEnabled: true, localeCount: 1 },
      },
      null,
      2,
    ),
  );

  const packageJsonPath = join(workDir, "package.json");
  await writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        name: "engawa-map-e2e-fixture",
        private: true,
        dependencies: {
          "@thierry-gilgen-ict/engawa-core": "0.1.1",
          "@thierry-gilgen-ict/engawa-discovery": "0.1.1",
          "@thierry-gilgen-ict/engawa-mcp": "0.1.1",
          "@thierry-gilgen-ict/engawa-react": "0.1.0",
        },
      },
      null,
      2,
    ),
  );

  const env = {
    ...process.env,
    ENGAWA_MAP_ENDPOINT: `http://127.0.0.1:${port}`,
    NODE_ENV: "test",
  };

  const runCli = (args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolveRun, reject) => {
      const child = spawn("pnpm", ["exec", "engawa-map", ...args], {
        cwd: workDir,
        env,
        shell: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
    });

  try {
    await runCli(["--version"]);
  } catch {
    console.warn(
      `Skipping engawa-map CLI execution; build engawa packages/map first from ${engawaRoot}`,
    );
    await app.close();
    await pool.end();
    await rm(workDir, { recursive: true, force: true });
    return;
  }

  const register = await runCli(["register", "--yes"]);
  if (register.code !== 0) {
    throw new Error(`register failed: ${register.stderr || register.stdout}`);
  }

  const status = await runCli(["status"]);
  if (status.code !== 0) {
    throw new Error(`status failed: ${status.stderr || status.stdout}`);
  }
  if (!status.stdout.includes("PENDING")) {
    throw new Error("expected PENDING in status output");
  }

  const unregister = await runCli(["unregister", "--yes"]);
  if (unregister.code !== 0) {
    throw new Error(`unregister failed: ${unregister.stderr || unregister.stdout}`);
  }

  console.log("E2E engawa-map CLI flow completed successfully.");
  await app.close();
  await pool.end();
  await rm(workDir, { recursive: true, force: true });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

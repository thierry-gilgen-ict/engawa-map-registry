import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const STAGING_HOSTNAME = "staging-engawa-map.thierry-gilgen-ict.ch";

const engawaRoot = process.env.ENGAWA_ROOT ?? resolve("..", "engawa");
const mapPackageDir = join(engawaRoot, "packages", "map");
const mapCliPath = join(mapPackageDir, "dist", "cli.js");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
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
}

async function buildEngawaMapCli(): Promise<void> {
  if (!(await pathExists(mapPackageDir))) {
    throw new Error(`engawa-map package not found at ${mapPackageDir}`);
  }

  const build = await runCommand(
    "pnpm",
    ["--dir", engawaRoot, "--filter", "@thierry-gilgen-ict/engawa-map", "build"],
    { env: process.env },
  );
  if (build.code !== 0) {
    throw new Error(`engawa-map build failed: ${build.stderr || build.stdout}`);
  }

  if (!(await pathExists(mapCliPath))) {
    throw new Error(`engawa-map CLI not found at ${mapCliPath} after build`);
  }
}

function resolveStagingEndpoint(): string {
  const raw = process.env.ENGAWA_MAP_ENDPOINT;
  if (!raw) {
    throw new Error("ENGAWA_MAP_ENDPOINT is required for staging acceptance");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ENGAWA_MAP_ENDPOINT must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("ENGAWA_MAP_ENDPOINT must use https for staging acceptance");
  }

  const override = process.env.ENGAWA_MAP_STAGING_ENDPOINT_OVERRIDE === "1";
  if (!override && parsed.hostname !== STAGING_HOSTNAME) {
    throw new Error(
      `ENGAWA_MAP_ENDPOINT hostname must be ${STAGING_HOSTNAME} (set ENGAWA_MAP_STAGING_ENDPOINT_OVERRIDE=1 to override)`,
    );
  }

  return parsed.origin;
}

async function waitForReady(endpoint: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/readyz`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  }
  throw new Error(`Registry at ${endpoint} did not become ready`);
}

async function createFixture(workDir: string, canonicalUrl: string): Promise<void> {
  await writeFile(
    join(workDir, "engawa-map.config.json"),
    JSON.stringify(
      {
        displayName: "Staging E2E Example",
        canonicalUrl,
        hints: { framework: "nextjs", byaEnabled: true, localeCount: 1 },
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(workDir, "package.json"),
    JSON.stringify(
      {
        name: "engawa-map-staging-e2e-fixture",
        private: true,
        dependencies: {
          "@thierry-gilgen-ict/engawa-core": "0.1.1",
        },
      },
      null,
      2,
    ),
  );

  const coreDir = join(workDir, "node_modules", "@thierry-gilgen-ict", "engawa-core");
  await mkdir(coreDir, { recursive: true });
  await writeFile(
    join(coreDir, "package.json"),
    JSON.stringify({ name: "@thierry-gilgen-ict/engawa-core", version: "0.1.1" }, null, 2),
  );
}

async function runMapCli(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runCommand("node", [mapCliPath, ...args], options);
}

async function main(): Promise<void> {
  const endpoint = resolveStagingEndpoint();
  await buildEngawaMapCli();
  await waitForReady(endpoint);

  let workDir: string | undefined;

  try {
    workDir = await mkdtemp(join(tmpdir(), "engawa-map-staging-e2e-"));
    const canonicalUrl = `https://staging-e2e-${Date.now()}.example.com`;
    await createFixture(workDir, canonicalUrl);

    const env = {
      ...process.env,
      ENGAWA_MAP_ENDPOINT: endpoint,
      NODE_ENV: "production",
    };

    const register = await runMapCli(["register", "--yes"], { cwd: workDir, env });
    if (register.code !== 0) {
      throw new Error(`register failed: ${register.stderr || register.stdout}`);
    }

    const status = await runMapCli(["status"], { cwd: workDir, env });
    if (status.code !== 0) {
      throw new Error(`status failed: ${status.stderr || status.stdout}`);
    }
    if (!status.stdout.includes("PENDING")) {
      throw new Error("expected PENDING in status output");
    }

    const localStateRaw = await readFile(join(workDir, ".engawa-map.local.json"), "utf8");
    const localState = JSON.parse(localStateRaw) as {
      registration: { siteId: string; siteToken: string };
    };
    const { siteId, siteToken } = localState.registration;

    const unregister = await runMapCli(["unregister"], { cwd: workDir, env });
    if (unregister.code !== 0) {
      throw new Error(`unregister failed: ${unregister.stderr || unregister.stdout}`);
    }

    const revokedStatus = await fetch(`${endpoint}/api/v1/sites/${siteId}/status`, {
      headers: { authorization: `Bearer ${siteToken}` },
    });
    if (revokedStatus.status !== 401) {
      throw new Error(`expected old token to return 401, got ${revokedStatus.status}`);
    }

    if (await pathExists(join(workDir, ".engawa-map.local.json"))) {
      throw new Error("expected .engawa-map.local.json to be removed");
    }

    const config = JSON.parse(
      await readFile(join(workDir, "engawa-map.config.json"), "utf8"),
    ) as Record<string, unknown>;
    if ("siteId" in config) {
      throw new Error("expected siteId to be removed from engawa-map.config.json");
    }

    console.log(`Staging engawa-map CLI E2E completed successfully against ${endpoint}.`);
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const COMMIT_MESSAGE =
  "feat: implement multi-tenant core framework, AES-256 data vault, and RLS schema dependencies";
const SENSITIVE_PATH =
  /(^|\/)(\.env(?:\.[^/]+)?|(?:id_rsa|id_ed25519|credentials(?:\.[^/]*)?|service-account(?:\.[^/]*)?|[^/]*private[-_]?key[^/]*))$|\.(?:pem|p12|pfx|key)$/i;

function usage() {
  console.error(
    "Usage: node scripts/setup-github.mjs --name <repo-name-or-owner/repo> --visibility <public|private|internal>",
  );
  process.exit(2);
}

function parseArguments(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!["--name", "--visibility"].includes(key) || !value || value.startsWith("--")) {
      usage();
    }
    if (options.has(key)) {
      usage();
    }
    options.set(key, value);
    index += 1;
  }

  const name = options.get("--name");
  const visibility = options.get("--visibility");
  if (
    !name ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(name) ||
    !["public", "private", "internal"].includes(visibility)
  ) {
    usage();
  }
  return { name, visibility };
}

function run(command, args, { allowNoChanges = false } = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: allowNoChanges ? ["inherit", "inherit", "pipe"] : "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`Could not start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    if (
      allowNoChanges &&
      result.status === 1 &&
      stderr.includes("nothing to commit")
    ) {
      console.log("No new changes to commit; keeping the existing commit.");
      return;
    }
    if (stderr) {
      process.stderr.write(stderr);
    }
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }
}

function assertNoSensitiveStagedPaths() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB", "-z"],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
  );
  if (result.error) {
    throw new Error(`Could not inspect staged paths: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error("Could not inspect staged changes before committing.");
  }

  const sensitivePaths = result.stdout
    .split("\0")
    .filter((path) => path && path !== ".env.example" && SENSITIVE_PATH.test(path));
  if (sensitivePaths.length > 0) {
    throw new Error(
      `Refusing to commit potentially sensitive files:\n${sensitivePaths.map((path) => `  ${path}`).join("\n")}\nRemove them from Git tracking and retry.`,
    );
  }
}

function main() {
  const { name, visibility } = parseArguments(process.argv.slice(2));
  if (!existsSync(resolve(process.cwd(), "package.json"))) {
    throw new Error("Run this script from the project root (package.json was not found).");
  }

  if (!existsSync(resolve(process.cwd(), ".git"))) {
    run("git", ["init", "--initial-branch=main"]);
  } else {
    const branch = spawnSync("git", ["branch", "--show-current"], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    });
    if (branch.error || branch.status !== 0) {
      throw new Error("Could not determine the current Git branch.");
    }
    if (branch.stdout.trim() !== "main") {
      run("git", ["branch", "-M", "main"]);
    }
  }

  run("git", ["add", "."]);
  assertNoSensitiveStagedPaths();
  run("git", ["commit", "-m", COMMIT_MESSAGE], { allowNoChanges: true });

  run("gh", ["auth", "status"]);
  const visibilityFlag = `--${visibility}`;
  run("gh", [
    "repo",
    "create",
    name,
    "--source=.",
    "--remote=origin",
    visibilityFlag,
  ]);
  run("git", ["push", "-u", "origin", "main"]);
  console.log(`GitHub repository ${name} is configured and pushed.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "GitHub setup failed.");
  process.exitCode = 1;
}

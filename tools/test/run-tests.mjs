import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable");
const testEnvironment = {
  ...process.env,
  DEMO_MODEL_MODE: "retrieval",
  MODEL_API_KEY: "",
  MODEL_NAME: "",
};

for (const [command, args] of [
  [process.execPath, [npmCli, "run", "build"]],
  [process.execPath, ["--test", "tests/rendered-html.test.mjs"]],
]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: testEnvironment,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["server/index.mjs"], {
  stdio: "inherit",
});
const url = `http://127.0.0.1:${process.env.PORT || 4173}`;
let opened = false;
const timer = setInterval(async () => {
  if (opened) return;
  try {
    if (!(await fetch(`${url}/api/health`)).ok) return;
    opened = true;
    clearInterval(timer);
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "rundll32"
          : "xdg-open";
    const args =
      process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", url]
        : [url];
    const opener = spawn(command, args, { stdio: "ignore", detached: true });
    opener.on("error", () => console.log(`请在浏览器打开 ${url}`));
    opener.unref();
  } catch {
    /* The local server is still starting. */
  }
}, 500);
child.on("exit", (code) => {
  clearInterval(timer);
  process.exitCode = code || 0;
});
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());

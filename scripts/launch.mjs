import { spawn } from "node:child_process";

const url = `http://127.0.0.1:${process.env.PORT || 4173}`;

async function isRunning() {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return (
      response.ok && (await response.json()).name === "still-english-reading"
    );
  } catch {
    return false;
  }
}

function openBrowser() {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    process.platform === "darwin"
      ? ["-a", "Google Chrome", url]
      : process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", url]
        : [url];
  return new Promise((resolve) => {
    const opener = spawn(command, args, { stdio: "ignore" });
    opener.on("error", () => {
      console.log(`无法自动打开浏览器，请在 Google Chrome 中打开 ${url}`);
      resolve();
    });
    opener.on("exit", (code) => {
      if (code)
        console.log(`无法自动打开浏览器，请在 Google Chrome 中打开 ${url}`);
      resolve();
    });
  });
}

// A second double-click should reopen the existing reader, not start a second server.
if (await isRunning()) {
  await openBrowser();
} else {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    stdio: "inherit",
  });
  let opened = false;
  let checking = false;
  let exited = false;
  const timer = setInterval(async () => {
    if (opened || checking || exited) return;
    checking = true;
    try {
      if (!(await isRunning()) || exited) return;
      opened = true;
      clearInterval(timer);
      await openBrowser();
    } finally {
      checking = false;
    }
  }, 400);
  child.on("error", () => {
    clearInterval(timer);
    console.error("本地服务启动失败，请检查 Node.js 安装。");
    process.exitCode = 1;
  });
  child.on("exit", async (code) => {
    exited = true;
    clearInterval(timer);
    // Another launch may have started the same service after our first check.
    if (!opened && (await isRunning())) {
      opened = true;
      await openBrowser();
      process.exitCode = 0;
    } else {
      process.exitCode = code || 0;
    }
  });
  process.on("SIGINT", () => child.kill());
  process.on("SIGTERM", () => child.kill());
}

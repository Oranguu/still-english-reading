import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createLibrary } from "./library.mjs";
import { createStorage } from "./storage.mjs";
import { createCodexBridge } from "./codex.mjs";

const toolDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const projectDir = path.dirname(toolDir);

export async function createApp(options = {}) {
  const sourceDir = path.resolve(
    options.sourceDir ||
      process.env.STILL_SOURCE_DIR ||
      path.join(projectDir, "source"),
  );
  const reviewDir = path.resolve(
    options.reviewDir ||
      process.env.STILL_REVIEW_DIR ||
      path.join(projectDir, "review"),
  );
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  const library = options.library || createLibrary({ sourceDir });
  const storage = options.storage || createStorage({ sourceDir, reviewDir });
  const ai = options.ai || createCodexBridge();
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    // A local website must not be able to spend the user's Codex quota or read books.
    const port = String(req.socket.localPort);
    const permittedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!permittedHosts.has(req.headers.host))
      return res.status(403).json({ error: "仅允许本机访问。" });
    const allowedOrigins = new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ]);
    if (process.env.NODE_ENV === "development") {
      allowedOrigins.add("http://127.0.0.1:5173");
      allowedOrigins.add("http://localhost:5173");
    }
    if (
      (req.headers.origin && !allowedOrigins.has(req.headers.origin)) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      return res.status(403).json({ error: "不允许其他网站访问本地书库。" });
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    if (
      ["POST", "PUT", "PATCH"].includes(req.method) &&
      !req.is("application/json")
    ) {
      return res.status(415).json({ error: "请求必须使用 JSON。" });
    }
    next();
  });
  app.use(express.json({ limit: "200kb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, name: "still-english-reading" }),
  );
  app.get("/api/books", async (_req, res) =>
    res.json({ books: await library.listBooks() }),
  );
  app.get("/api/books/:id/file", async (req, res) => {
    const file = await library.getFile(req.params.id);
    res.sendFile(file);
  });
  app.get("/api/books/:id/assets", async (req, res) => {
    if (typeof req.query.path !== "string")
      return res.status(400).json({ error: "缺少资源路径。" });
    const asset = await library.getAsset(req.params.id, req.query.path);
    res.type(asset.mimeType).send(asset.buffer);
  });
  app.get("/api/books/:id/state", async (req, res) => {
    await library.getFile(req.params.id);
    res.json({ state: await storage.getState(req.params.id) });
  });
  app.put("/api/books/:id/state", async (req, res) => {
    await library.getFile(req.params.id);
    res.json({ state: await storage.saveState(req.params.id, req.body) });
  });
  app.get("/api/books/:id", async (req, res) =>
    res.json({ book: await library.getBook(req.params.id) }),
  );
  app.get("/api/reviews", async (_req, res) =>
    res.json({ items: await storage.listReviews() }),
  );
  app.post("/api/reviews", async (req, res) => {
    const books = await library.listBooks();
    const book = books.find((item) => item.id === req.body?.bookId);
    if (!book)
      return res.status(404).json({ error: "来源书籍不存在，请刷新书库。" });
    const item = await storage.addReview({
      ...req.body,
      bookTitle: book.title,
    });
    res.status(201).json({ item });
  });
  app.patch("/api/reviews/:id", async (req, res) =>
    res.json({ item: await storage.updateReview(req.params.id, req.body) }),
  );
  app.delete("/api/reviews/:id", async (req, res) => {
    await storage.deleteReview(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/ai/status", async (_req, res) => res.json(await ai.status()));
  const withCancellation = (handler) => async (req, res) => {
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    try {
      await handler(req, res, controller.signal);
    } finally {
      res.off("close", onClose);
    }
  };
  app.post(
    "/api/ai/explain",
    withCancellation(async (req, res, signal) => {
      res.json({ answer: await ai.explain(req.body || {}, signal) });
    }),
  );
  app.post(
    "/api/books/:id/outline",
    withCancellation(async (req, res, signal) => {
      const book = await library.getBook(req.params.id);
      if (book.outline?.length && !book.outlineGenerated) {
        return res
          .status(409)
          .json({ error: "这本书已有目录，可以直接使用。" });
      }
      const sample = await library.getOutlineSample(req.params.id);
      if (book.isImageOnly || sample.isImageOnly) {
        return res
          .status(422)
          .json({
            error:
              "这是图片型 PDF，不建议使用 AI 生成大纲，以免消耗过多额度。请先在本地进行 OCR。",
          });
      }
      const outline = await ai.generateOutline(
        { ...sample, bookTitle: book.title },
        signal,
      );
      if (signal.aborted) return;
      await library.saveOutline(req.params.id, outline);
      res.json({ outline });
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "接口不存在。" }),
  );
  app.use(express.static(path.join(toolDir, "dist")));
  app.get("/", (_req, res) =>
    res
      .status(503)
      .type("text")
      .send("请先运行 npm run build，再启动阅读工具。"),
  );
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    let status = Number(error.status || error.statusCode) || 500;
    if (error.type === "entity.too.large") status = 413;
    if (error.code === "ENOENT") status = 404;
    if (error instanceof SyntaxError && error.type === "entity.parse.failed")
      status = 400;
    const message =
      status === 413
        ? "内容过长，请缩小选择范围。"
        : status === 404 && error.code === "ENOENT"
          ? "未找到文件，请刷新书库。"
          : error.message || "暂时无法完成操作。";
    res
      .status(status >= 400 && status < 600 ? status : 500)
      .json({ error: message });
  });
  return { app, close: () => ai.close(), library, storage };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("PORT 必须为 1024–65535。");
  const { app, close } = await createApp();
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`still. 英文阅读已启动：http://127.0.0.1:${port}`),
  );
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `端口 ${port} 正在使用；请打开已有页面，或设置 PORT。`
        : "本地服务启动失败。",
    );
    close();
    process.exitCode = 1;
  });
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    close();
    server.close();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

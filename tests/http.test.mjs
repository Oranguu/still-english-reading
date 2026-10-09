import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/index.mjs";

async function setup(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "still-http-")),
  );
  const sourceDir = path.join(root, "source");
  const reviewDir = path.join(root, "review");
  await fs.mkdir(sourceDir);
  await fs.writeFile(
    path.join(sourceDir, "sample.md"),
    "# Small steps\n\nSmall steps make a difference.\n\n## Practice\n\nRead every day.",
  );
  await fs.writeFile(
    path.join(sourceDir, "plain.md"),
    "Small steps make a difference. ".repeat(30),
  );
  let calls = 0;
  const ai = {
    status: async () => ({
      available: true,
      authenticated: true,
      accountType: "chatgpt",
    }),
    explain: async ({ text }) => {
      calls++;
      return `解析：${text}`;
    },
    generateOutline: async ({ locations }) => {
      calls++;
      const first = locations[0];
      return [
        {
          id: "ai-1",
          title: "Small steps",
          level: 1,
          location: first.location || first,
        },
      ];
    },
    close() {},
  };
  const { app, close } = await createApp({ sourceDir, reviewDir, ai });
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, "127.0.0.1", () => resolve(handle));
  });
  t.after(async () => {
    close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method = "GET", body, headers = {}) =>
    fetch(url + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { request, url, sourceDir, reviewDir, calls: () => calls };
}

test("HTTP: library → bookmark → review persistence, without embedding private fixtures", async (t) => {
  const { request, sourceDir, reviewDir } = await setup(t);
  let response = await request("/api/books");
  assert.equal(response.status, 200);
  const { books } = await response.json();
  assert.equal(books.length, 2);
  const book = books.find((item) => item.relativePath === "sample.md");
  response = await request(`/api/books/${book.id}`);
  const { book: opened } = await response.json();
  assert.ok(opened.chapters[0].html.includes("Small steps"));
  assert.equal(opened.outline.length, 2);
  const location = { chapterId: opened.chapters[0].id, scrollRatio: 0.4 };
  response = await request(`/api/books/${book.id}/state`, "PUT", {
    location,
    progress: 40,
    bookmarks: [{ id: "bookmark-test", label: "Practice", location }],
  });
  assert.equal(response.status, 200);
  const saved = (await (await request(`/api/books/${book.id}/state`)).json())
    .state;
  assert.equal(saved.location.scrollRatio, 0.4);
  assert.equal(saved.bookmarks.length, 1);
  response = await request("/api/reviews", "POST", {
    bookId: book.id,
    bookTitle: "Untrusted name",
    type: "phrase",
    text: "small steps",
    note: "小步前进",
    location,
  });
  assert.equal(response.status, 201);
  const { item } = await response.json();
  assert.equal(item.bookTitle, book.title);
  const reviewedAt = new Date().toISOString();
  response = await request(`/api/reviews/${item.id}`, "PATCH", { reviewedAt });
  assert.equal((await response.json()).item.reviewedAt, reviewedAt);
  assert.equal((await (await request("/api/reviews")).json()).items.length, 1);
  assert.ok(
    (await fs.readFile(path.join(reviewDir, "items.json"), "utf8")).includes(
      "small steps",
    ),
  );
  assert.ok(
    (
      await fs.readFile(
        path.join(sourceDir, ".still-english-reading/state.json"),
        "utf8",
      )
    ).includes("Practice"),
  );
  assert.equal(
    (await request(`/api/reviews/${item.id}`, "DELETE")).status,
    200,
  );
  assert.equal((await (await request("/api/reviews")).json()).items.length, 0);
});

test("HTTP: rejects cross-site requests, DNS rebinding hosts, invalid content and paths", async (t) => {
  const { request, url, calls } = await setup(t);
  assert.equal(
    (
      await request("/api/books", "GET", undefined, {
        Origin: "https://example.com",
      })
    ).status,
    403,
  );
  const reboundStatus = await new Promise((resolve, reject) => {
    http
      .get(
        url + "/api/books",
        { headers: { Host: "example.com" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(reboundStatus, 403);
  assert.equal(
    (
      await request(
        "/api/ai/explain",
        "POST",
        { text: "sample" },
        { "Sec-Fetch-Site": "cross-site" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/ai/explain",
        "POST",
        { text: "sample" },
        { "Content-Type": "text/plain" },
      )
    ).status,
    415,
  );
  assert.equal(calls(), 0);
  assert.equal((await request("/api/books/unknown/file")).status, 404);
  assert.equal(
    (
      await request("/api/reviews", "POST", {
        bookId: "../outside",
        text: "sample",
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/api/ai/explain", "POST", { text: "x".repeat(220000) }))
      .status,
    413,
  );
  const response = await request("/api/health");
  assert.ok(
    response.headers
      .get("content-security-policy")
      .includes("object-src 'none'"),
  );
});

test("HTTP: AI outline is persisted in source and existing native outline is protected", async (t) => {
  const { request, sourceDir, calls } = await setup(t);
  const { books } = await (await request("/api/books")).json();
  const plain = books.find((book) => book.relativePath === "plain.md");
  const native = books.find((book) => book.relativePath === "sample.md");
  assert.equal(
    (await request(`/api/books/${native.id}/outline`, "POST", {})).status,
    409,
  );
  assert.equal(calls(), 0);
  const response = await request(`/api/books/${plain.id}/outline`, "POST", {});
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).outline.length, 1);
  const files = await fs.readdir(
    path.join(sourceDir, ".still-english-reading"),
  );
  assert.ok(
    files.some((file) => file.includes(plain.id) && file.endsWith(".json")),
  );
  const { book } = await (await request(`/api/books/${plain.id}`)).json();
  assert.equal(book.outlineGenerated, true);
});

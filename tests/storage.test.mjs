import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStorage } from "../server/storage.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "still-storage-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceDir = path.join(directory, "source");
  const reviewDir = path.join(directory, "review");
  await fs.mkdir(sourceDir);
  return {
    directory,
    sourceDir,
    reviewDir,
    storage: createStorage({ sourceDir, reviewDir }),
  };
}

test("reading state defaults, bookmarks and scroll position persist without dropping other fields", async (t) => {
  const { storage, sourceDir, reviewDir } = await fixture(t);
  assert.deepEqual(await storage.getState("book-1"), {
    location: null,
    progress: 0,
    bookmarks: [],
  });
  const result = await storage.saveState("book-1", {
    location: { chapterId: "main", anchor: "heading-1", scrollRatio: 0.45 },
    progress: 45,
    bookmarks: [{ label: "An idea", location: { chapterId: "main" } }],
  });
  assert.ok(result.bookmarks[0].id);
  await storage.saveState("book-1", { progress: 50 });
  const restored = await createStorage({ sourceDir, reviewDir }).getState(
    "book-1",
  );
  assert.equal(restored.progress, 50);
  assert.equal(restored.location.scrollRatio, 0.45);
  assert.equal(restored.bookmarks[0].label, "An idea");
  await assert.rejects(
    storage.saveState("book-1", {
      location: { chapterId: "main", scrollRatio: 2 },
    }),
    /进度/,
  );
  await assert.rejects(storage.getState("__proto__"), /无效/);
});

test("concurrent review additions are atomic and edits preserve creation metadata", async (t) => {
  const { storage, reviewDir } = await fixture(t);
  const entries = await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      storage.addReview({
        bookId: "book-1",
        bookTitle: "Sample Book",
        type: "word",
        text: `word ${index}`,
        note: "An explanation",
        location: { page: 3 },
      }),
    ),
  );
  assert.equal((await storage.listReviews()).length, 25);
  assert.equal(new Set(entries.map((item) => item.id)).size, 25);
  const reviewedAt = new Date().toISOString();
  const updated = await storage.updateReview(entries[0].id, {
    note: "Revised explanation",
    reviewedAt,
  });
  assert.equal(updated.createdAt, entries[0].createdAt);
  assert.equal(updated.reviewedAt, reviewedAt);
  assert.equal(
    (await storage.updateReview(updated.id, { type: "phrase" })).reviewedAt,
    reviewedAt,
  );
  await storage.deleteReview(entries[1].id);
  assert.equal((await storage.listReviews()).length, 24);
  assert.deepEqual((await fs.readdir(reviewDir)).sort(), ["items.json"]);
  await assert.rejects(
    storage.addReview({
      bookId: "book-1",
      bookTitle: "Book",
      type: "unknown",
      text: "x",
    }),
    /收藏类型/,
  );
  await assert.rejects(
    storage.addReview({
      bookId: "book-1",
      bookTitle: "Book",
      type: "word",
      text: "x".repeat(20001),
    }),
    /20000/,
  );
});

test("state and review symlinks cannot overwrite data outside managed directories", async (t) => {
  const { storage, directory, sourceDir, reviewDir } = await fixture(t);
  const outside = path.join(directory, "outside.json");
  await fs.writeFile(outside, "[]");
  await fs.mkdir(reviewDir);
  await fs.symlink(outside, path.join(reviewDir, "items.json"));
  await assert.rejects(
    storage.addReview({
      bookId: "book-1",
      bookTitle: "Book",
      type: "word",
      text: "test",
    }),
    /符号链接/,
  );
  assert.equal(await fs.readFile(outside, "utf8"), "[]");
  const elsewhere = path.join(directory, "elsewhere");
  await fs.mkdir(elsewhere);
  await fs.symlink(elsewhere, path.join(sourceDir, ".still-english-reading"));
  await assert.rejects(
    storage.saveState("book-1", { progress: 10 }),
    /符号链接/,
  );
  assert.deepEqual(await fs.readdir(elsewhere), []);
});

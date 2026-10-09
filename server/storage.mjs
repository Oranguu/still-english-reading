import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const queues = new Map();

export function validationError(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

export function safeId(value, field = "ID") {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  ) {
    throw validationError(`${field} 无效。`);
  }
  return value;
}

function text(value, field, max, { required = false } = {}) {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw validationError(`${field} 不能为空或超过 ${max} 个字符。`);
  }
  return value.trim();
}

export function validateLocation(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw validationError("阅读位置无效。");
  const result = {};
  if ("page" in value) {
    if (!Number.isInteger(value.page) || value.page < 1 || value.page > 100000)
      throw validationError("页码无效。");
    result.page = value.page;
  }
  if ("chapterId" in value)
    result.chapterId = text(value.chapterId, "章节 ID", 300, {
      required: true,
    });
  if ("anchor" in value) result.anchor = text(value.anchor, "章节锚点", 500);
  if ("scrollRatio" in value) {
    if (
      !Number.isFinite(value.scrollRatio) ||
      value.scrollRatio < 0 ||
      value.scrollRatio > 1
    )
      throw validationError("阅读进度无效。");
    result.scrollRatio = value.scrollRatio;
  }
  if (!("page" in result) && !("chapterId" in result))
    throw validationError("阅读位置缺少页码或章节。");
  return result;
}

async function rejectSymlinks(filename) {
  const absolute = path.resolve(filename);
  const { root } = path.parse(absolute);
  let current = root;
  for (const segment of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw validationError("数据路径不能包含符号链接。", 403);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function readJsonFile(filename, fallback) {
  await rejectSymlinks(filename);
  try {
    const info = await fs.stat(filename);
    if (info.size > 30 * 1024 * 1024)
      throw validationError("本地数据文件过大。", 413);
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    if (error instanceof SyntaxError)
      throw validationError(
        "本地数据文件损坏，请先备份并修复 JSON 文件。",
        500,
      );
    throw error;
  }
}

// Serializing read-modify-write transactions prevents concurrent browser requests
// from overwriting each other's bookmarks or review cards.
export async function mutateJsonFile(filename, fallback, mutate) {
  const previous = queues.get(filename) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      await rejectSymlinks(filename);
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const current = await readJsonFile(filename, fallback);
      const { data, result } = await mutate(current);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        await rejectSymlinks(filename);
        await fs.rename(temporary, filename);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return structuredClone(result);
    });
  queues.set(filename, operation);
  try {
    return await operation;
  } finally {
    if (queues.get(filename) === operation) queues.delete(filename);
  }
}

function normalizeBookmark(bookmark) {
  if (!bookmark || typeof bookmark !== "object")
    throw validationError("书签无效。");
  const location = validateLocation(bookmark.location);
  if (!location) throw validationError("书签需要阅读位置。");
  return {
    id: bookmark.id ? safeId(bookmark.id, "书签 ID") : randomUUID(),
    label: text(bookmark.label ?? bookmark.title ?? "书签", "书签名称", 500),
    location,
    createdAt: validDate(bookmark.createdAt) || new Date().toISOString(),
  };
}

function validDate(value) {
  return typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : undefined;
}

function normalizeReview(input, existing) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw validationError("复习内容无效。");
  const merged = { ...existing, ...input };
  if (!["word", "phrase", "sentence"].includes(merged.type))
    throw validationError("收藏类型必须是单词、短语或句子。");
  if (merged.reviewedAt != null && !validDate(merged.reviewedAt))
    throw validationError("复习时间无效。");
  return {
    id: existing?.id ?? randomUUID(),
    bookId: safeId(merged.bookId, "书籍 ID"),
    bookTitle: text(merged.bookTitle, "书名", 1000, { required: true }),
    type: merged.type,
    text: text(merged.text, "收藏内容", 20000, { required: true }),
    note: text(merged.note, "解析笔记", 50000),
    context: text(merged.context, "上下文", 20000),
    location: validateLocation(merged.location),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviewedAt: merged.reviewedAt == null ? null : validDate(merged.reviewedAt),
  };
}

export function createStorage({ sourceDir, reviewDir }) {
  const stateFile = path.join(
    path.resolve(sourceDir),
    ".still-english-reading",
    "state.json",
  );
  const reviewFile = path.join(path.resolve(reviewDir), "items.json");
  return {
    async getState(bookId) {
      safeId(bookId, "书籍 ID");
      const states = await readJsonFile(stateFile, {});
      return structuredClone(
        states[bookId] ?? { location: null, progress: 0, bookmarks: [] },
      );
    },
    async saveState(bookId, input) {
      safeId(bookId, "书籍 ID");
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw validationError("阅读记录无效。");
      const patch = {};
      if ("location" in input)
        patch.location = validateLocation(input.location);
      if ("progress" in input) {
        if (
          !Number.isFinite(input.progress) ||
          input.progress < 0 ||
          input.progress > 100
        )
          throw validationError("阅读进度应介于 0 和 100。");
        patch.progress = input.progress;
      }
      if ("bookmarks" in input) {
        if (!Array.isArray(input.bookmarks) || input.bookmarks.length > 2000)
          throw validationError("书签数量超过限制。");
        patch.bookmarks = input.bookmarks.map(normalizeBookmark);
        if (
          new Set(patch.bookmarks.map((item) => item.id)).size !==
          patch.bookmarks.length
        )
          throw validationError("书签 ID 不能重复。");
      }
      return mutateJsonFile(stateFile, {}, (states) => {
        const result = {
          location: null,
          progress: 0,
          bookmarks: [],
          ...states[bookId],
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        return { data: { ...states, [bookId]: result }, result };
      });
    },
    async listReviews() {
      const items = await readJsonFile(reviewFile, []);
      if (!Array.isArray(items)) throw validationError("复习库格式无效。", 500);
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async addReview(input) {
      const result = normalizeReview(input);
      return mutateJsonFile(reviewFile, [], (items) => {
        if (items.length >= 20000)
          throw validationError("复习库已达到 20000 张卡片，请先整理。", 413);
        return { data: [...items, result], result };
      });
    },
    async updateReview(id, patch) {
      safeId(id, "卡片 ID");
      return mutateJsonFile(reviewFile, [], (items) => {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) throw validationError("找不到该复习卡片。", 404);
        const result = normalizeReview(patch, items[index]);
        items[index] = result;
        return { data: items, result };
      });
    },
    async deleteReview(id) {
      safeId(id, "卡片 ID");
      return mutateJsonFile(reviewFile, [], (items) => {
        if (!items.some((item) => item.id === id))
          throw validationError("找不到该复习卡片。", 404);
        return {
          data: items.filter((item) => item.id !== id),
          result: { deleted: true },
        };
      });
    },
  };
}

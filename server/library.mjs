import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import {
  mutateJsonFile,
  readJsonFile,
  safeId,
  validateLocation,
  validationError,
} from "./storage.mjs";

const MB = 1024 * 1024;
const MAX_FILE = 256 * MB;
const MAX_ENTRY = 20 * MB;
const MAX_ARCHIVE = 160 * MB;
const MAX_CHAPTER_TEXT = 16 * MB;
const MAX_SAMPLE = 24000;
const imageTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};
const xml = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
});
const asArray = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const stripHtml = (value) =>
  sanitizeHtml(String(value), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const bookIdFor = (relativePath) =>
  createHash("sha256").update(relativePath).digest("hex").slice(0, 24);
const inside = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

function xmlText(value) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(xmlText).join(" ");
  return Object.entries(value)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, part]) => xmlText(part))
    .join(" ")
    .trim();
}

function parseXml(content) {
  if (
    Buffer.byteLength(content) > 2 * MB ||
    /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(content)
  )
    throw validationError("EPUB XML 包含不支持的实体或内容过大。", 413);
  return xml.parse(content);
}

function localReference(base, value) {
  if (
    typeof value !== "string" ||
    !value ||
    /[\x00-\x1f\\]/.test(value) ||
    /^([a-z][a-z\d+.-]*:|\/\/|\/)/i.test(value)
  )
    return null;
  const [filename, fragment = ""] = value.split("#", 2);
  let decoded;
  let anchor;
  try {
    decoded = decodeURIComponent(filename.split("?")[0]);
    anchor = decodeURIComponent(fragment);
  } catch {
    return null;
  }
  if (/[\x00-\x1f\\]/.test(decoded) || decoded.startsWith("/")) return null;
  const resolved = decoded
    ? path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded))
    : base;
  if (
    resolved === ".." ||
    resolved.startsWith("../") ||
    path.posix.isAbsolute(resolved)
  )
    return null;
  return { path: resolved, anchor };
}

function sanitizeChapter(
  content,
  { bookId, chapterPath, chapterId, chapterMap },
) {
  return sanitizeHtml(content, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
    allowedAttributes: {
      "*": ["id", "title", "lang", "dir"],
      a: ["href", "data-chapter-id", "data-anchor"],
      img: ["src", "alt", "title", "loading"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      ol: ["start"],
    },
    allowedSchemes: [],
    allowProtocolRelative: false,
    nonTextTags: [
      "style",
      "script",
      "textarea",
      "option",
      "noscript",
      "iframe",
      "object",
      "head",
    ],
    transformTags: {
      image: (_tag, attrs) => {
        const reference = localReference(
          chapterPath,
          attrs["xlink:href"] || attrs.href,
        );
        const src =
          reference &&
          imageTypes[path.posix.extname(reference.path).toLowerCase()]
            ? `/api/books/${bookId}/assets?path=${encodeURIComponent(reference.path)}`
            : undefined;
        return {
          tagName: "img",
          attribs: {
            ...(src ? { src } : {}),
            alt: attrs.alt || "",
            loading: "lazy",
          },
        };
      },
      img: (_tag, attrs) => {
        const reference = localReference(chapterPath, attrs.src);
        const src =
          reference &&
          imageTypes[path.posix.extname(reference.path).toLowerCase()]
            ? `/api/books/${bookId}/assets?path=${encodeURIComponent(reference.path)}`
            : undefined;
        return {
          tagName: "img",
          attribs: {
            ...(src ? { src } : {}),
            alt: attrs.alt || "",
            loading: "lazy",
          },
        };
      },
      a: (_tag, attrs) => {
        const reference = localReference(chapterPath, attrs.href);
        const target =
          reference &&
          (chapterMap.get(reference.path) ||
            (reference.path === chapterPath ? chapterId : null));
        return {
          tagName: "a",
          attribs: {
            ...(attrs.id ? { id: attrs.id } : {}),
            ...(target
              ? {
                  href: `#${reference.anchor}`,
                  "data-chapter-id": target,
                  "data-anchor": reference.anchor,
                }
              : {}),
          },
        };
      },
    },
  });
}

function sanitizeSvg(buffer) {
  return Buffer.from(
    sanitizeHtml(buffer.toString("utf8"), {
      allowedTags: [
        "svg",
        "g",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "title",
        "desc",
      ],
      allowedAttributes: {
        "*": [
          "xmlns",
          "viewBox",
          "width",
          "height",
          "x",
          "y",
          "x1",
          "x2",
          "y1",
          "y2",
          "cx",
          "cy",
          "r",
          "rx",
          "ry",
          "d",
          "points",
          "fill",
          "stroke",
          "stroke-width",
          "transform",
          "opacity",
          "font-size",
          "text-anchor",
        ],
      },
      parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
      transformTags: {
        "*": (tagName, attributes) => ({
          tagName,
          attribs: Object.fromEntries(
            Object.entries(attributes).filter(
              ([, value]) => !/url\s*\(|[<>]/i.test(value),
            ),
          ),
        }),
      },
    }),
  );
}

// Inspect central-directory sizes before JSZip allocates decompressed content.
// ZIP64 and multipart archives are intentionally unsupported for local ebooks.
function validateZip(buffer) {
  let end = -1;
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65557);
    offset--
  ) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw validationError("EPUB 不是有效的 ZIP 文件。");
  const count = buffer.readUInt16LE(end + 10);
  if (
    buffer.readUInt16LE(end + 4) ||
    buffer.readUInt16LE(end + 6) ||
    count === 65535 ||
    count > 5000
  )
    throw validationError("EPUB 文件数量过多或压缩格式不受支持。", 413);
  let offset = buffer.readUInt32LE(end + 16);
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw validationError("EPUB 压缩目录已损坏。");
    const size = buffer.readUInt32LE(offset + 24);
    if (
      size === 0xffffffff ||
      size > MAX_ENTRY ||
      (total += size) > MAX_ARCHIVE
    )
      throw validationError("EPUB 解压后的内容超过安全限制。", 413);
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
    if (offset > end) throw validationError("EPUB 压缩目录已损坏。");
  }
}

async function loadZip(filename) {
  const buffer = await fs.readFile(filename);
  validateZip(buffer);
  const archive = await JSZip.loadAsync(buffer);
  for (const item of Object.values(archive.files)) {
    const name = item.unsafeOriginalName || item.name;
    if (
      /\\|\0/.test(name) ||
      path.posix.isAbsolute(name) ||
      name.split("/").includes("..")
    )
      throw validationError("EPUB 包含不安全的资源路径。");
  }
  return archive;
}

async function zipBuffer(archive, filename) {
  const item = archive.file(filename);
  if (!item) throw validationError(`EPUB 中缺少资源：${filename}`, 404);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const stream = item.nodeStream("nodebuffer");
    stream.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_ENTRY) {
        stream.destroy(validationError("EPUB 资源超过安全限制。", 413));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function parseEpub(filename, book) {
  const archive = await loadZip(filename);
  const container = parseXml(
    (await zipBuffer(archive, "META-INF/container.xml")).toString("utf8"),
  );
  const opfPath = asArray(container.container?.rootfiles?.rootfile)[0]?.[
    "@_full-path"
  ];
  if (!opfPath || !localReference("root", opfPath))
    throw validationError("EPUB 缺少有效的书籍目录。");
  const opf = parseXml(
    (await zipBuffer(archive, opfPath)).toString("utf8"),
  ).package;
  if (!opf) throw validationError("EPUB 书籍元数据无效。");
  const manifest = new Map(
    asArray(opf.manifest?.item).map((item) => [item["@_id"], item]),
  );
  const chapterItems = asArray(opf.spine?.itemref)
    .map((ref) => manifest.get(ref["@_idref"]))
    .filter((item) => item && /html/.test(item["@_media-type"]));
  if (!chapterItems.length)
    throw validationError("EPUB 没有可阅读的章节，或书籍受 DRM 保护。");
  if (chapterItems.length > 1500)
    throw validationError("EPUB 章节数量超过限制。", 413);
  const chapterMap = new Map();
  chapterItems.forEach((item, index) => {
    const reference = localReference(opfPath, item["@_href"]);
    if (!reference) throw validationError("EPUB 章节路径无效。");
    chapterMap.set(reference.path, `chapter-${index + 1}`);
  });
  let outline = [];
  const addItem = (title, href, level, base) => {
    const target = localReference(base, href);
    if (!target || !chapterMap.has(target.path)) return;
    const location = {
      chapterId: chapterMap.get(target.path),
      ...(target.anchor ? { anchor: target.anchor } : {}),
    };
    outline.push({
      id: `toc-${outline.length + 1}`,
      title: stripHtml(title).slice(0, 1000) || "未命名章节",
      level,
      location,
    });
  };
  const nav = [...manifest.values()].find((item) =>
    String(item["@_properties"] || "")
      .split(/\s+/)
      .includes("nav"),
  );
  if (nav) {
    const navPath = localReference(opfPath, nav["@_href"])?.path;
    if (navPath) {
      const navDoc = parseXml(
        (await zipBuffer(archive, navPath)).toString("utf8"),
      );
      const findNav = (node) => {
        if (!node || typeof node !== "object") return [];
        return Object.entries(node).flatMap(([key, value]) =>
          key === "nav"
            ? asArray(value)
            : key.startsWith("@_")
              ? []
              : asArray(value).flatMap(findNav),
        );
      };
      const navs = findNav(navDoc);
      const toc =
        navs.find((item) =>
          String(item["@_type"] || "")
            .split(/\s+/)
            .includes("toc"),
        ) || navs[0];
      const visit = (list, level = 1) => {
        for (const item of asArray(list?.li)) {
          const link = asArray(item.a)[0];
          if (link)
            addItem(xmlText(link), link["@_href"], Math.min(level, 6), navPath);
          for (const child of asArray(item.ol)) visit(child, level + 1);
        }
      };
      if (toc) for (const list of asArray(toc.ol)) visit(list);
    }
  }
  if (!outline.length) {
    const ncx =
      manifest.get(opf.spine?.["@_toc"]) ||
      [...manifest.values()].find(
        (item) => item["@_media-type"] === "application/x-dtbncx+xml",
      );
    const ncxPath = ncx && localReference(opfPath, ncx["@_href"])?.path;
    if (ncxPath) {
      const ncxDoc = parseXml(
        (await zipBuffer(archive, ncxPath)).toString("utf8"),
      );
      const visit = (items, level = 1) => {
        for (const item of asArray(items)) {
          addItem(
            xmlText(item.navLabel?.text),
            item.content?.["@_src"],
            Math.min(level, 6),
            ncxPath,
          );
          visit(item.navPoint, level + 1);
        }
      };
      visit(ncxDoc.ncx?.navMap?.navPoint);
    }
  }
  const chapters = [];
  let totalText = 0;
  for (const [chapterPath, chapterId] of chapterMap) {
    const content = (await zipBuffer(archive, chapterPath)).toString("utf8");
    if ((totalText += Buffer.byteLength(content)) > MAX_CHAPTER_TEXT)
      throw validationError("EPUB 文字内容过大，请拆分后阅读。", 413);
    const html = sanitizeChapter(content, {
      bookId: book.id,
      chapterPath,
      chapterId,
      chapterMap,
    });
    const heading = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html)?.[1];
    const title =
      outline.find((item) => item.location.chapterId === chapterId)?.title ||
      stripHtml(heading || "") ||
      `第 ${chapters.length + 1} 章`;
    chapters.push({ id: chapterId, title, html, location: { chapterId } });
  }
  if (!outline.length) {
    for (const chapter of chapters) {
      const headings = [
        ...chapter.html.matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi),
      ];
      let number = 0;
      chapter.html = chapter.html.replace(
        /<h([1-6])([^>]*)>/gi,
        (_whole, level, attrs) => {
          number++;
          return /\bid\s*=/.test(attrs)
            ? `<h${level}${attrs}>`
            : `<h${level}${attrs} id="heading-${number}">`;
        },
      );
      headings.forEach((heading, index) => {
        const anchor =
          /\bid="([^"]*)"/.exec(heading[2])?.[1] || `heading-${index + 1}`;
        outline.push({
          id: `toc-${outline.length + 1}`,
          title: stripHtml(heading[3]),
          level: Number(heading[1]),
          location: { chapterId: chapter.id, anchor },
        });
      });
    }
  }
  return {
    ...book,
    title: xmlText(opf.metadata?.title) || book.title,
    author: xmlText(opf.metadata?.creator) || "",
    chapters,
    outline,
  };
}

async function parseMarkdown(filename, book) {
  const content = await fs.readFile(filename, "utf8");
  if (Buffer.byteLength(content) > MAX_CHAPTER_TEXT)
    throw validationError("Markdown 内容过大，请拆分后阅读。", 413);
  const outline = [];
  const markdown = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const anchor = `heading-${outline.length + 1}`;
        outline.push({
          id: anchor,
          title: stripHtml(html),
          level: depth,
          location: { chapterId: "main", anchor },
        });
        return `<h${depth} id="${anchor}">${html}</h${depth}>\n`;
      },
    },
  });
  let html = sanitizeChapter(await markdown.parse(content), {
    bookId: book.id,
    chapterPath: book.relativePath,
    chapterId: "main",
    chapterMap: new Map([[book.relativePath, "main"]]),
  });
  if (!outline.length) {
    let paragraph = 0;
    html = html.replace(/<p>/g, () => `<p id="passage-${++paragraph}">`);
  }
  return {
    ...book,
    title: outline.find((item) => item.level === 1)?.title || book.title,
    outline,
    chapters: [
      { id: "main", title: book.title, html, location: { chapterId: "main" } },
    ],
  };
}

async function withPdf(filename, fn) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const distribution = path.dirname(
    fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")),
  );
  const task = getDocument({
    data: new Uint8Array(await fs.readFile(filename)),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: path.join(distribution, "standard_fonts") + path.sep,
    cMapUrl: path.join(distribution, "cmaps") + path.sep,
    cMapPacked: true,
  });
  try {
    return await fn(await task.promise);
  } finally {
    await task.destroy();
  }
}

async function pageText(pdf, number) {
  const page = await pdf.getPage(number);
  try {
    return (await page.getTextContent()).items
      .map((item) => item.str || "")
      .join(" ")
      .trim();
  } finally {
    page.cleanup();
  }
}

async function parsePdf(filename, book) {
  return withPdf(filename, async (pdf) => {
    const metadata = await pdf.getMetadata().catch(() => ({}));
    const outline = [];
    const visit = async (items, level = 1) => {
      for (const item of items || []) {
        let destination = item.dest;
        if (typeof destination === "string")
          destination = await pdf.getDestination(destination).catch(() => null);
        if (Array.isArray(destination) && destination[0] != null) {
          const index =
            typeof destination[0] === "number"
              ? destination[0]
              : await pdf.getPageIndex(destination[0]).catch(() => -1);
          if (index >= 0 && index < pdf.numPages)
            outline.push({
              id: `toc-${outline.length + 1}`,
              title: item.title,
              level: Math.min(level, 6),
              location: { page: index + 1 },
            });
        }
        await visit(item.items, level + 1);
      }
    };
    await visit(await pdf.getOutline().catch(() => []));
    const samples = [
      ...new Set(
        [
          1,
          2,
          3,
          Math.ceil(pdf.numPages / 4),
          Math.ceil(pdf.numPages / 2),
          Math.ceil((pdf.numPages * 3) / 4),
          pdf.numPages,
        ].filter((number) => number <= pdf.numPages),
      ),
    ];
    let textLength = 0;
    for (const number of samples)
      textLength += (await pageText(pdf, number)).replace(/\s/g, "").length;
    return {
      ...book,
      title: metadata.info?.Title?.trim() || book.title,
      author: metadata.info?.Author?.trim() || "",
      pageCount: pdf.numPages,
      outline,
      chapters: [],
      isImageOnly: textLength < 30,
      textDetection: "sampled",
    };
  });
}

export function createLibrary({ sourceDir }) {
  const source = path.resolve(sourceDir);
  const cache = new Map();

  async function checkedFile(filename) {
    if (!inside(source, filename)) throw validationError("资源路径越界。", 403);
    const rootReal = await fs.realpath(source);
    let current = source;
    for (const segment of path
      .relative(source, filename)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, segment);
      if ((await fs.lstat(current)).isSymbolicLink())
        throw validationError("不支持符号链接资源。", 403);
    }
    if (!inside(rootReal, await fs.realpath(filename)))
      throw validationError("资源路径越界。", 403);
    const stat = await fs.stat(filename);
    if (!stat.isFile()) throw validationError("找不到该文件。", 404);
    if (stat.size > MAX_FILE)
      throw validationError("单本书籍不能超过 256 MB。", 413);
    return stat;
  }

  async function listBooks() {
    await fs.mkdir(source, { recursive: true });
    const books = [];
    async function walk(directory, depth = 0) {
      if (depth > 12 || books.length >= 3000) return;
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(filename, depth + 1);
        else if (
          entry.isFile() &&
          /\.(pdf|epub|md|markdown)$/i.test(entry.name)
        ) {
          const stat = await checkedFile(filename);
          const relativePath = path
            .relative(source, filename)
            .split(path.sep)
            .join("/");
          const extension = path.extname(entry.name).slice(1).toLowerCase();
          const id = bookIdFor(relativePath);
          books.push({
            id,
            title: path.basename(entry.name, path.extname(entry.name)),
            author: "",
            format: extension === "markdown" ? "md" : extension,
            relativePath,
            size: stat.size,
          });
        }
      }
    }
    await walk(source);
    return books.sort((a, b) => a.title.localeCompare(b.title));
  }

  async function findBook(id) {
    safeId(id, "书籍 ID");
    const book = (await listBooks()).find((item) => item.id === id);
    if (!book) throw validationError("找不到这本书，请刷新书库。", 404);
    return book;
  }

  function outlinePath(id) {
    return path.join(
      source,
      ".still-english-reading",
      `${safeId(id)}.outline.json`,
    );
  }

  async function readOutline(id) {
    const stored = await readJsonFile(outlinePath(id), null);
    return stored?.outline ?? null;
  }

  async function getBook(id) {
    const book = await findBook(id);
    const filename = path.join(source, book.relativePath);
    const stat = await checkedFile(filename);
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    let parsed = cache.get(id)?.stamp === stamp ? cache.get(id).value : null;
    if (!parsed) {
      parsed = await { pdf: parsePdf, epub: parseEpub, md: parseMarkdown }[
        book.format
      ](filename, book);
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      cache.set(id, { stamp, value: parsed });
    }
    const generated = await readOutline(id);
    return structuredClone({
      ...parsed,
      ...(generated ? { outline: generated } : {}),
      outlineGenerated: Boolean(generated),
    });
  }

  return {
    listBooks,
    getBook,
    readOutline,
    async getFile(id) {
      const book = await findBook(id);
      const filename = path.join(source, book.relativePath);
      await checkedFile(filename);
      return filename;
    },
    async getAsset(id, assetPath) {
      const book = await findBook(id);
      if (
        typeof assetPath !== "string" ||
        assetPath.length > 2000 ||
        /[\x00-\x1f\\]/.test(assetPath) ||
        assetPath.startsWith("/") ||
        assetPath.split("/").includes("..")
      )
        throw validationError("资源路径无效。", 403);
      const mimeType = imageTypes[path.extname(assetPath).toLowerCase()];
      if (!mimeType) throw validationError("仅支持书籍中的图片资源。", 403);
      let buffer;
      if (book.format === "epub")
        buffer = await zipBuffer(
          await loadZip(path.join(source, book.relativePath)),
          assetPath,
        );
      else if (book.format === "md") {
        const filename = path.resolve(source, assetPath);
        const stat = await checkedFile(filename);
        if (stat.size > MAX_ENTRY) throw validationError("图片资源过大。", 413);
        buffer = await fs.readFile(filename);
      } else throw validationError("该格式不提供图片资源。", 404);
      return {
        buffer: mimeType === "image/svg+xml" ? sanitizeSvg(buffer) : buffer,
        mimeType,
      };
    },
    async getOutlineSample(id) {
      const book = await getBook(id);
      if (book.isImageOnly)
        return { text: "", isImageOnly: true, locations: [] };
      const locations = [];
      const parts = [];
      if (book.format === "pdf") {
        await withPdf(path.join(source, book.relativePath), async (pdf) => {
          const count = Math.min(pdf.numPages, 80);
          const pages = [
            ...new Set(
              Array.from({ length: count }, (_, index) =>
                count === 1
                  ? 1
                  : 1 + Math.round((index * (pdf.numPages - 1)) / (count - 1)),
              ),
            ),
          ];
          const perPage = Math.max(
            200,
            Math.floor((MAX_SAMPLE - count * 32) / count),
          );
          for (const number of pages) {
            const content = await pageText(pdf, number);
            if (content) {
              locations.push({ page: number });
              parts.push(`[PAGE ${number}]\n${content.slice(0, perPage)}`);
            }
          }
        });
      } else if (
        book.format === "md" &&
        /id="passage-/.test(book.chapters[0]?.html || "")
      ) {
        const passages = [
          ...book.chapters[0].html.matchAll(
            /<p id="(passage-\d+)">([\s\S]*?)<\/p>/g,
          ),
        ];
        const count = Math.min(passages.length, 80);
        const indices = [
          ...new Set(
            Array.from({ length: count }, (_, i) =>
              count === 1
                ? 0
                : Math.round((i * (passages.length - 1)) / (count - 1)),
            ),
          ),
        ];
        const perPassage = Math.max(
          100,
          Math.floor((MAX_SAMPLE - count * 80) / Math.max(count, 1)),
        );
        for (const index of indices) {
          const passage = passages[index];
          locations.push({ chapterId: "main", anchor: passage[1] });
          parts.push(
            `[CHAPTER main ANCHOR ${passage[1]}]\n${stripHtml(passage[2]).slice(0, perPassage)}`,
          );
        }
      } else {
        const chapters = book.chapters.slice(0, 300);
        const perChapter = Math.max(
          30,
          Math.floor((MAX_SAMPLE - chapters.length * 50) / chapters.length),
        );
        for (const chapter of chapters) {
          locations.push(chapter.location);
          parts.push(
            `[CHAPTER ${chapter.id}] ${chapter.title}\n${stripHtml(chapter.html).slice(0, perChapter)}`,
          );
        }
      }
      return {
        text: parts.join("\n\n").slice(0, MAX_SAMPLE),
        isImageOnly: false,
        locations,
      };
    },
    async saveOutline(id, input) {
      const book = await getBook(id);
      if (!Array.isArray(input) || !input.length || input.length > 500)
        throw validationError("生成的大纲需要 1–500 个条目。");
      const outline = input.map((item, index) => {
        if (
          !item ||
          typeof item.title !== "string" ||
          !item.title.trim() ||
          item.title.length > 1000
        )
          throw validationError("大纲标题无效。");
        const location = validateLocation(item.location);
        if (
          !location ||
          (book.format === "pdf"
            ? !location.page || location.page > book.pageCount
            : !book.chapters.some(
                (chapter) => chapter.id === location.chapterId,
              ))
        )
          throw validationError("大纲位置不属于这本书。");
        return {
          id: `generated-${index + 1}`,
          title: item.title.trim(),
          level: Number.isInteger(item.level)
            ? Math.min(6, Math.max(1, item.level))
            : 1,
          location,
        };
      });
      return mutateJsonFile(outlinePath(id), null, () => ({
        data: {
          version: 1,
          bookId: id,
          createdAt: new Date().toISOString(),
          outline,
        },
        result: outline,
      }));
    },
  };
}

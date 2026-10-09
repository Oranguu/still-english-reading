import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createLibrary } from "../server/library.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "still-library-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceDir = path.join(directory, "source");
  await fs.mkdir(sourceDir);
  return { directory, sourceDir, library: createLibrary({ sourceDir }) };
}

function epubFixture({ ncx = false } = {}) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    '<container><rootfiles><rootfile full-path="EPUB/book.opf"/></rootfiles></container>',
  );
  zip.file(
    "EPUB/book.opf",
    `<package><metadata><dc:title xmlns:dc="urn:dc">A Test Book</dc:title><dc:creator xmlns:dc="urn:dc">Sample Author</dc:creator></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>${ncx ? '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'}</manifest><spine toc="toc"><itemref idref="a"/><itemref idref="b"/></spine></package>`,
  );
  zip.file(
    "EPUB/a.xhtml",
    '<html><head><title>Ignore me</title><style>body{display:none}</style></head><body><h1 id="opening">Opening</h1><p>Read this sentence and learn something useful.</p><a href="b.xhtml#next">Next</a><img src="images/cover.png"/><img src="https://tracking.invalid/image"/><script>alert(1)</script><iframe src="https://tracking.invalid/"></iframe></body></html>',
  );
  zip.file(
    "EPUB/b.xhtml",
    '<html><body><h2 id="next">Next</h2><p>Here is the second chapter.</p></body></html>',
  );
  zip.file("EPUB/images/cover.png", Buffer.from([137, 80, 78, 71]));
  zip.file(
    "EPUB/nav.xhtml",
    '<html><body><nav epub:type="toc" xmlns:epub="urn:epub"><ol><li><a href="a.xhtml#opening">Opening</a><ol><li><a href="b.xhtml#next">A second chapter</a></li></ol></li></ol></nav></body></html>',
  );
  zip.file(
    "EPUB/toc.ncx",
    '<ncx><navMap><navPoint><navLabel><text>Opening</text></navLabel><content src="a.xhtml#opening"/><navPoint><navLabel><text>A second chapter</text></navLabel><content src="b.xhtml#next"/></navPoint></navPoint></navMap></ncx>',
  );
  return zip;
}

function pdfFixture(text = "") {
  const content = text ? `BT /F1 12 Tf 40 740 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

test("Markdown loads heading outline and sanitized HTML, assets stay within source", async (t) => {
  const { directory, sourceDir, library } = await fixture(t);
  await fs.mkdir(path.join(sourceDir, "reading"));
  await fs.writeFile(
    path.join(sourceDir, "reading", "sample.md"),
    "# First Chapter\n\nAn **important** thought.\n\n## A detail\n\n![cover](cover.png)\n\n<script>window.stolen=true</script>\n\n![remote](https://invalid.example/tracker.png)",
  );
  await fs.writeFile(
    path.join(sourceDir, "reading", "cover.png"),
    Buffer.from([137, 80, 78, 71]),
  );
  const outside = path.join(directory, "private.md");
  await fs.writeFile(outside, "# Private file");
  await fs.symlink(outside, path.join(sourceDir, "linked.md"));
  const books = await library.listBooks();
  assert.equal(books.length, 1);
  assert.equal(books[0].relativePath, "reading/sample.md");
  const book = await library.getBook(books[0].id);
  assert.equal(book.title, "First Chapter");
  assert.equal(book.outline.length, 2);
  assert.deepEqual(book.outline[1].location, {
    chapterId: "main",
    anchor: "heading-2",
  });
  assert.match(book.chapters[0].html, /<strong>important<\/strong>/);
  assert.doesNotMatch(book.chapters[0].html, /script|stolen|https:\/\//);
  assert.match(book.chapters[0].html, /assets\?path=reading%2Fcover.png/);
  assert.equal(
    (await library.getAsset(book.id, "reading/cover.png")).mimeType,
    "image/png",
  );
  await assert.rejects(library.getAsset(book.id, "../outside.png"), /路径/);
  await assert.rejects(library.getAsset(book.id, "reading/sample.md"), /图片/);
  await fs.symlink(outside, path.join(sourceDir, "escape.png"));
  await assert.rejects(library.getAsset(book.id, "escape.png"), /符号链接/);
});

for (const ncx of [false, true])
  test(`EPUB ${ncx ? "NCX" : "navigation document"} preserves spine, hierarchy and safe internal links`, async (t) => {
    const { sourceDir, library } = await fixture(t);
    await fs.writeFile(
      path.join(sourceDir, "sample.epub"),
      await epubFixture({ ncx }).generateAsync({ type: "nodebuffer" }),
    );
    const [entry] = await library.listBooks();
    const book = await library.getBook(entry.id);
    assert.equal(book.title, "A Test Book");
    assert.equal(book.author, "Sample Author");
    assert.equal(book.chapters.length, 2);
    assert.equal(book.outline[1].level, 2);
    assert.deepEqual(book.outline[1].location, {
      chapterId: "chapter-2",
      anchor: "next",
    });
    assert.match(book.chapters[0].html, /data-chapter-id="chapter-2"/);
    assert.doesNotMatch(
      book.chapters[0].html,
      /tracking|script|iframe|display:none|Ignore me/,
    );
    assert.equal(
      (await library.getAsset(book.id, "EPUB/images/cover.png")).buffer.length,
      4,
    );
    const sample = await library.getOutlineSample(book.id);
    assert.equal(sample.locations[0].chapterId, "chapter-1");
    assert.ok(sample.text.includes("[CHAPTER chapter-2]"));
  });

test("generated outline persists locally and rejects destinations outside the book", async (t) => {
  const { sourceDir, library } = await fixture(t);
  await fs.writeFile(
    path.join(sourceDir, "plain.md"),
    "An opening paragraph with no headings.",
  );
  const [entry] = await library.listBooks();
  const generated = await library.saveOutline(entry.id, [
    {
      title: "Opening",
      level: 1,
      location: { chapterId: "main", scrollRatio: 0 },
    },
  ]);
  assert.equal(generated[0].id, "generated-1");
  const restored = await createLibrary({ sourceDir }).getBook(entry.id);
  assert.equal(restored.outlineGenerated, true);
  assert.equal(restored.outline[0].title, "Opening");
  assert.ok(
    await fs.stat(
      path.join(
        sourceDir,
        ".still-english-reading",
        `${entry.id}.outline.json`,
      ),
    ),
  );
  await assert.rejects(
    library.saveOutline(entry.id, [
      { title: "Wrong", location: { chapterId: "nonexistent" } },
    ]),
    /不属于/,
  );
});

test("EPUB rejects traversal entry names and oversized decompression metadata", async (t) => {
  const { sourceDir, library } = await fixture(t);
  const unsafe = epubFixture();
  unsafe.file("../escape.txt", "bad");
  await fs.writeFile(
    path.join(sourceDir, "unsafe.epub"),
    await unsafe.generateAsync({ type: "nodebuffer" }),
  );
  const [entry] = await library.listBooks();
  await assert.rejects(library.getBook(entry.id), /不安全/);
  const oversized = await epubFixture().generateAsync({ type: "nodebuffer" });
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversized.writeUInt32LE(30 * 1024 * 1024, central + 24);
  await fs.writeFile(path.join(sourceDir, "large.epub"), oversized);
  const large = (await library.listBooks()).find(
    (book) => book.title === "large",
  );
  await assert.rejects(library.getBook(large.id), /安全限制/);
});

test("PDF extracts text and identifies textless pages without rendering or OCR", async (t) => {
  const { sourceDir, library } = await fixture(t);
  await fs.writeFile(
    path.join(sourceDir, "text.pdf"),
    pdfFixture(
      "This is a useful sentence for learning English and reading carefully.",
    ),
  );
  await fs.writeFile(path.join(sourceDir, "scan.pdf"), pdfFixture());
  const books = await library.listBooks();
  const textBook = await library.getBook(
    books.find((book) => book.title === "text").id,
  );
  assert.equal(textBook.pageCount, 1);
  assert.equal(textBook.isImageOnly, false);
  const textSample = await library.getOutlineSample(textBook.id);
  assert.match(textSample.text, /useful sentence/);
  assert.deepEqual(textSample.locations, [{ page: 1 }]);
  const scan = await library.getBook(
    books.find((book) => book.title === "scan").id,
  );
  assert.equal(scan.isImageOnly, true);
  assert.deepEqual(await library.getOutlineSample(scan.id), {
    text: "",
    isImageOnly: true,
    locations: [],
  });
});

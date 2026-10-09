// Browser checks use generated public-domain fixtures and a deterministic tutor.
// Real Codex connectivity is verified separately; this test consumes no quota.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";
const root = await fs.mkdtemp(
  path.join(await fs.realpath(os.tmpdir()), "still-browser-"),
);
const sourceDir = path.join(root, "source"),
  reviewDir = path.join(root, "review");
await fs.mkdir(sourceDir);
await fs.mkdir(".artifacts", { recursive: true });
await fs.writeFile(
  path.join(sourceDir, "Daily reading.md"),
  "# Daily reading\n\nSmall steps make a difference.\n\n## A daily habit\n\n" +
    Array.from(
      { length: 35 },
      (_, i) =>
        `Practice ${i + 1}: Read a few pages, pause to reflect, and keep learning with curiosity.\n\n`,
    ).join("") +
    "## Keep going\n\nProgress comes with practice.",
);
await fs.writeFile(
  path.join(sourceDir, "Without headings.md"),
  "Small steps make a difference.\n\nPractice every day.\n\nKeep a curious mind.",
);
const zip = new JSZip();
zip.file(
  "META-INF/container.xml",
  '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
);
zip.file(
  "book.opf",
  '<package><metadata><title>A Little Reading</title></metadata><manifest><item id="a" href="first.xhtml" media-type="application/xhtml+xml"/><item id="b" href="second.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
);
zip.file(
  "first.xhtml",
  '<html><body><h1 id="start">A fresh start</h1><p>Reading opens a window to the world.</p><a href="second.xhtml#next">Next chapter</a></body></html>',
);
zip.file(
  "second.xhtml",
  '<html><body><h1 id="next">A new perspective</h1><p>Every page brings a new idea.</p></body></html>',
);
zip.file(
  "nav.xhtml",
  '<html><nav epub:type="toc"><ol><li><a href="first.xhtml#start">A fresh start</a></li><li><a href="second.xhtml#next">A new perspective</a></li></ol></nav></html>',
);
await fs.writeFile(
  path.join(sourceDir, "A Little Reading.epub"),
  await zip.generateAsync({ type: "nodebuffer" }),
);
function pdf(text = "") {
  const stream = text ? `BT /F1 16 Tf 40 740 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let textPdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((value, i) => {
    offsets.push(Buffer.byteLength(textPdf));
    textPdf += `${i + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = Buffer.byteLength(textPdf);
  return (
    textPdf +
    `xref\n0 6\n0000000000 65535 f \n${offsets.map((v) => String(v).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  );
}
await fs.writeFile(
  path.join(sourceDir, "Readable PDF.pdf"),
  pdf(
    "Small steps make a difference and help us learn something new every day.",
  ),
);
await fs.writeFile(path.join(sourceDir, "Scanned PDF.pdf"), pdf());
const calls = [];
const ai = {
  status: async () => ({
    available: true,
    authenticated: true,
    accountType: "chatgpt",
    rateLimits: { primary: { remainingPercent: 75, windowMinutes: 300 } },
  }),
  explain: async (input) => {
    calls.push(input);
    return input.messages?.length
      ? "这里的 difference 表示积极的影响。"
      : "**翻译**：小小的行动，也能带来改变。\n\n**make a difference**：产生影响。";
  },
  generateOutline: async ({ locations }) =>
    locations.map((location, i) => ({
      id: `outline-${i}`,
      title: `Reading passage ${i + 1}`,
      level: 1,
      location,
    })),
  close() {},
};
const { app, close } = await createApp({ sourceDir, reviewDir, ai });
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function select(selector, text) {
  await page.locator(selector).evaluate((element, phrase) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf(phrase);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + phrase.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error("Selection target not found");
  }, text);
}
async function open(name) {
  await page
    .locator(".book-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .click();
  await expect(page.locator(".reading-content")).toBeAttached();
}
async function back() {
  await page.getByRole("button", { name: "返回书库" }).click();
  await expect(page.locator(".book-grid")).toBeVisible();
}
try {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".book-card")).toHaveCount(5);
  await page.screenshot({
    path: ".artifacts/library-demo.png",
    fullPage: true,
  });
  await open("Daily reading");
  await expect(page.locator(".outline-list button")).toHaveCount(3);
  await select(".reading-content", "Small steps");
  await expect(page.locator(".assistant-message")).toContainText("产生影响");
  await page.getByLabel("收藏分类").selectOption("phrase");
  await page.locator(".selection-save button").click();
  await expect(page.locator(".selection-save button")).toContainText("已收藏");
  await page.getByLabel("向 AI 追问").fill("difference 在这里是什么意思？");
  await page.getByRole("button", { name: "发送追问" }).click();
  await expect(page.locator(".assistant-message").last()).toContainText(
    "积极的影响",
  );
  assert.equal(calls[1].messages.at(-1).role, "user");
  await page.screenshot({ path: ".artifacts/study-demo.png", fullPage: true });
  await page.getByRole("button", { name: "关闭 AI 解析" }).click();
  await page
    .locator(".reading-scroll")
    .evaluate((el) => (el.scrollTop = el.scrollHeight * 0.35));
  await page.waitForTimeout(150);
  const savedTop = await page
    .locator(".reading-scroll")
    .evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "添加书签" }).click();
  await page.locator(".reading-scroll").evaluate((el) => (el.scrollTop = 0));
  await page
    .locator(".reader-side-tabs")
    .getByRole("button", { name: /书签/ })
    .click();
  await page.locator(".bookmark-item>button").first().click();
  await expect
    .poll(() => page.locator(".reading-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(savedTop - 50);
  await back();
  await page.getByRole("button", { name: /复习卡片/ }).click();
  await expect(page.locator(".review-card")).toHaveCount(1);
  await expect(page.locator(".review-card-body")).toHaveCount(0);
  await page.locator(".review-card-summary").click();
  await expect(page.locator(".review-note")).toContainText("产生影响");
  await page.getByRole("button", { name: "我复习过了" }).click();
  await expect(page.locator(".review-date")).toHaveText("已复习");
  await page.getByRole("button", { name: "来源书籍", exact: true }).click();
  await expect(page.locator(".source-heading")).toContainText("Daily reading");
  await page.screenshot({ path: ".artifacts/review-demo.png", fullPage: true });
  await page.getByRole("button", { name: /我的书库/ }).click();
  await open("A Little Reading");
  await page.locator(".outline-list button").last().click();
  await expect(page.locator(".reading-content")).toContainText(
    "Every page brings a new idea.",
  );
  await back();
  await open("Without headings");
  await page.getByRole("button", { name: "智能生成大纲" }).click();
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.locator(".outline-list button")).toHaveCount(3);
  await back();
  await open("Readable PDF");
  await expect(page.locator(".pdf-page canvas")).toBeVisible();
  await expect(page.locator(".textLayer")).toContainText("Small steps");
  await select(".textLayer", "Small steps");
  await expect(page.locator(".assistant-message")).toBeVisible();
  await page.getByRole("button", { name: "关闭 AI 解析" }).click();
  await back();
  await open("Scanned PDF");
  await expect(
    page.getByRole("button", { name: "智能生成大纲" }),
  ).toBeDisabled();
  await back();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".artifacts/mobile-demo.png", fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "No mobile horizontal overflow",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const reviews = JSON.parse(
    await fs.readFile(path.join(reviewDir, "items.json"), "utf8"),
  );
  assert.equal(reviews.length, 1);
  assert.ok(reviews[0].reviewedAt);
  console.log(
    "PASS: library, EPUB, Markdown, PDF text selection, AI follow-up, outline, same-chapter bookmark restore, collapsed review cards, categories, disk persistence and mobile layout",
  );
} catch (error) {
  await page.screenshot({
    path: ".artifacts/browser-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}

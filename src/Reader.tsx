import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import PdfReader from "./PdfReader";
import { FormattedText } from "./App";
import {
  api,
  inferType,
  messageOf,
  typeLabels,
  type AIStatus,
  type Book,
  type Location,
  type Message,
  type ReadingState,
  type ReviewType,
} from "./types";

type Selection = { text: string; context: string; location: Location };
const emptyState: ReadingState = { bookmarks: [], progress: 0 };

export default function Reader({
  bookId,
  status,
  onBack,
  onSaved,
  notify,
}: {
  bookId: string;
  status: AIStatus | null;
  onBack: () => void;
  onSaved: () => void;
  notify: (message: string) => void;
}) {
  const [book, setBook] = useState<Book | null>(null);
  const [reading, setReading] = useState<ReadingState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [sideTab, setSideTab] = useState<"outline" | "bookmarks">("outline");
  const [fontSize, setFontSize] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.9);
  const [fontFamily, setFontFamily] = useState("serif");
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saveType, setSaveType] = useState<ReviewType>("word");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [outlineBusy, setOutlineBusy] = useState(false);
  const [outlineConfirm, setOutlineConfirm] = useState(false);
  const [saveStatus, setSaveStatus] = useState("已保存");
  const [navigationVersion, setNavigationVersion] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const aiScroll = useRef<HTMLDivElement>(null);
  const aiRequest = useRef<AbortController | null>(null);
  const outlineRequest = useRef<AbortController | null>(null);
  const latestState = useRef<ReadingState>(emptyState);
  const initialized = useRef(false);
  const previousSelection = useRef("");
  const scrollRestore = useRef(false);
  const chapterIndex = Math.max(
    0,
    book?.chapters?.findIndex(
      (chapter) => chapter.id === reading.location?.chapterId,
    ) ?? 0,
  );
  const chapter = book?.chapters?.[chapterIndex];
  const page = reading.location?.page || 1;
  const totalChapters = book?.chapters?.length || 1;
  const isPdf = book?.format === "pdf";

  useEffect(() => {
    let active = true;
    initialized.current = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<{ book: Book }>(`/api/books/${bookId}`),
      api<{ state: ReadingState }>(`/api/books/${bookId}/state`),
    ])
      .then(([details, stateData]) => {
        if (!active) return;
        const next = {
          ...emptyState,
          ...stateData.state,
          bookmarks: stateData.state?.bookmarks || [],
        };
        next.location =
          next.location ||
          (details.book.format === "pdf"
            ? { page: 1 }
            : { chapterId: details.book.chapters?.[0]?.id });
        setBook(details.book);
        setPageCount(details.book.pageCount || 1);
        setReading(next);
        latestState.current = next;
        initialized.current = true;
        setLoading(false);
      })
      .catch((error) => {
        if (active) {
          setError(messageOf(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      aiRequest.current?.abort();
      outlineRequest.current?.abort();
      if (initialized.current) {
        void fetch(`/api/books/${bookId}/state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(latestState.current),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [bookId]);

  useEffect(() => {
    latestState.current = reading;
    if (!initialized.current) return;
    setSaveStatus("保存中…");
    const timer = setTimeout(() => {
      void api(`/api/books/${bookId}/state`, {
        method: "PUT",
        body: JSON.stringify(reading),
      })
        .then(() => setSaveStatus("已保存"))
        .catch((error) => {
          setSaveStatus("保存失败");
          notify(messageOf(error));
        });
    }, 650);
    return () => clearTimeout(timer);
  }, [reading, bookId, notify]);

  useEffect(() => {
    const flush = () => {
      if (initialized.current)
        void fetch(`/api/books/${bookId}/state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(latestState.current),
          keepalive: true,
        }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [bookId]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);
  useEffect(() => {
    if (!scroll.current || loading) return;
    scrollRestore.current = true;
    const timer = requestAnimationFrame(() => {
      const node = scroll.current;
      if (!node) return;
      const anchor = reading.location?.anchor;
      const target =
        anchor && article.current
          ? Array.from(article.current.querySelectorAll("[id]")).find(
              (element) => element.id === anchor,
            )
          : null;
      if (target) target.scrollIntoView({ block: "start" });
      else
        node.scrollTop =
          (reading.location?.scrollRatio || 0) *
          Math.max(0, node.scrollHeight - node.clientHeight);
      requestAnimationFrame(() => {
        scrollRestore.current = false;
      });
    });
    return () => cancelAnimationFrame(timer);
    // Restoring scroll should occur on navigation, never on each saved scroll update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id, page, navigationVersion, loading]);

  useEffect(() => {
    aiScroll.current?.scrollTo({
      top: aiScroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, aiBusy]);

  const navigate = useCallback(
    (location: Location) => {
      if (!book) return;
      previousSelection.current = "";
      const next = { ...location };
      let progress = 0;
      if (book.format === "pdf") {
        next.page = Math.min(Math.max(1, next.page || 1), pageCount);
        progress = next.page / pageCount;
      } else {
        if (!next.chapterId) next.chapterId = book.chapters?.[0]?.id;
        const index = Math.max(
          0,
          book.chapters?.findIndex((value) => value.id === next.chapterId) || 0,
        );
        progress = index / totalChapters;
      }
      setReading((current) => ({ ...current, location: next, progress }));
      setNavigationVersion((version) => version + 1);
    },
    [book, pageCount, totalChapters],
  );

  function onReadingScroll() {
    if (scrollRestore.current || !scroll.current || !initialized.current)
      return;
    const node = scroll.current;
    const ratio =
      node.scrollHeight <= node.clientHeight
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              node.scrollTop / (node.scrollHeight - node.clientHeight),
            ),
          );
    setReading((current) => ({
      ...current,
      location: { ...current.location, anchor: undefined, scrollRatio: ratio },
      progress: isPdf
        ? (page - 1 + ratio) / pageCount
        : (chapterIndex + ratio) / totalChapters,
    }));
  }

  async function explain(target: Selection, history: Message[] = []) {
    aiRequest.current?.abort();
    const request = new AbortController();
    aiRequest.current = request;
    setAiError("");
    // Always let the local bridge check current login, so retry works after login changes.
    setAiBusy(true);
    try {
      const result = await api<{ answer: string }>("/api/ai/explain", {
        method: "POST",
        body: JSON.stringify({
          text: target.text,
          context: target.context,
          bookTitle: book?.title,
          messages: history,
        }),
        signal: request.signal,
      });
      if (!request.signal.aborted)
        setMessages([
          ...history,
          { role: "assistant", content: result.answer },
        ]);
    } catch (error) {
      if (!request.signal.aborted) setAiError(messageOf(error));
    } finally {
      if (!request.signal.aborted) setAiBusy(false);
    }
  }

  function captureSelection() {
    const native = window.getSelection();
    if (
      !native ||
      native.isCollapsed ||
      !native.rangeCount ||
      !article.current?.contains(native.anchorNode) ||
      !article.current.contains(native.focusNode)
    )
      return;
    const text = native.toString().trim();
    if (!text || text === previousSelection.current) return;
    if (text.length > 6000) {
      notify("一次选择最多 6,000 个字符，请选取更短的段落。");
      return;
    }
    previousSelection.current = text;
    const ancestor = native.getRangeAt(0).commonAncestorContainer;
    const element =
      ancestor instanceof Element ? ancestor : ancestor.parentElement;
    let context =
      element?.closest("p,li,blockquote,section,.textLayer")?.textContent ||
      element?.textContent ||
      text;
    const textIndex = context.indexOf(text);
    if (context.length > 4000)
      context = context.slice(
        Math.max(0, textIndex - 1000),
        Math.max(0, textIndex - 1000) + 4000,
      );
    const target = { text, context, location: { ...reading.location } };
    setSelection(target);
    setSaveType(inferType(text));
    setMessages([]);
    setQuestion("");
    setSaved(false);
    void explain(target);
  }

  function closeAI() {
    aiRequest.current?.abort();
    setAiBusy(false);
    setSelection(null);
    previousSelection.current = "";
    window.getSelection()?.removeAllRanges();
  }
  function stopAI() {
    aiRequest.current?.abort();
    setAiBusy(false);
    setAiError("解析已停止，可以重新尝试。");
  }
  async function saveReview(note?: string) {
    if (!selection || !book) return;
    setSaving(true);
    try {
      await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          bookId,
          bookTitle: book.title,
          type: saveType,
          text: selection.text,
          note:
            note ??
            [...messages].reverse().find((value) => value.role === "assistant")
              ?.content ??
            "",
          context: selection.context,
          location: selection.location,
        }),
      });
      setSaved(true);
      onSaved();
      notify("已加入复习卡片。");
    } catch (error) {
      notify(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  function addBookmark() {
    const location = { ...reading.location };
    const label = isPdf ? `第 ${page} 页` : chapter?.title || "阅读位置";
    if (
      reading.bookmarks.some(
        (mark) => JSON.stringify(mark.location) === JSON.stringify(location),
      )
    ) {
      notify("这个位置已有书签。");
      return;
    }
    setReading((current) => ({
      ...current,
      bookmarks: [
        ...current.bookmarks,
        {
          id: crypto.randomUUID(),
          label,
          location,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    notify("书签已留下，下次从这里继续。");
  }

  async function generateOutline() {
    if (!book || book.isImageOnly) return;
    setOutlineConfirm(false);
    setOutlineBusy(true);
    const controller = new AbortController();
    outlineRequest.current = controller;
    try {
      const result = await api<{ outline: Book["outline"] }>(
        `/api/books/${bookId}/outline`,
        { method: "POST", signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setBook((current) =>
          current
            ? { ...current, outline: result.outline, outlineGenerated: true }
            : current,
        );
        notify("阅读大纲已生成，并保存在本地。");
      }
    } catch (error) {
      if (!controller.signal.aborted) notify(messageOf(error));
    } finally {
      if (!controller.signal.aborted) setOutlineBusy(false);
    }
  }

  function handleLink(event: React.MouseEvent) {
    const target = event.target as Element;
    const link = target.closest("a");
    if (!link) return;
    if (link.dataset.chapterId) {
      event.preventDefault();
      navigate({
        chapterId: link.dataset.chapterId,
        anchor: link.dataset.anchor || undefined,
      });
    } else if (link.getAttribute("href")?.startsWith("#")) {
      event.preventDefault();
      navigate({
        chapterId: chapter?.id,
        anchor: decodeURIComponent(link.getAttribute("href")!.slice(1)),
      });
    } else if (link.href && /^https?:/.test(link.href)) {
      event.preventDefault();
      window.open(link.href, "_blank", "noopener,noreferrer");
    }
  }

  const currentBookmark = reading.bookmarks.some((mark) =>
    isPdf
      ? mark.location.page === page
      : mark.location.chapterId === chapter?.id &&
        Math.abs(
          (mark.location.scrollRatio || 0) -
            (reading.location?.scrollRatio || 0),
        ) < 0.02,
  );
  const step = (direction: number) =>
    isPdf
      ? navigate({ page: page + direction })
      : navigate({ chapterId: book?.chapters?.[chapterIndex + direction]?.id });

  useEffect(() => {
    if (loading || !book) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !["ArrowUp", "ArrowDown"].includes(event.key) ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        document.querySelector("dialog[open], [aria-modal='true']") ||
        window.getSelection()?.isCollapsed === false
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable], [role='textbox'], [role='combobox'], [role='listbox'], [role='slider'], [role='spinbutton'], .ai-panel, .reader-sidebar, .typography-popover",
        )
      )
        return;

      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (book.format === "pdf") {
        const nextPage = page + direction;
        if (nextPage >= 1 && nextPage <= pageCount)
          navigate({ page: nextPage });
        return;
      }
      const container = scroll.current;
      if (!container) return;
      const limit = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      const nextTop = Math.max(
        0,
        Math.min(
          limit,
          container.scrollTop +
            direction * Math.max(1, container.clientHeight - 48),
        ),
      );
      if (Math.abs(nextTop - container.scrollTop) > 1) {
        container.scrollTo({ top: nextTop, behavior: "instant" });
      } else {
        const nextChapter = book.chapters?.[chapterIndex + direction];
        if (nextChapter)
          navigate({
            chapterId: nextChapter.id,
            scrollRatio: direction < 0 ? 1 : 0,
          });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [book, loading, page, pageCount, chapterIndex, navigate]);

  if (loading || error || !book)
    return (
      <div className="reader-loading-screen">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} /> 返回书库
        </button>
        <div className="empty-state">
          {loading ? (
            <LoaderCircle className="spin" size={32} />
          ) : (
            <BookOpen size={32} />
          )}
          <h2>{loading ? "翻开一本书…" : "这本书暂时无法打开"}</h2>
          <p>{error || "正在读取内容与上次的阅读位置。"}</p>
        </div>
      </div>
    );

  return (
    <div className="reader-layout">
      <header className="reader-topbar">
        <div className="reader-header-left">
          <button
            className="icon-button back-button"
            onClick={onBack}
            aria-label="返回书库"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="reader-brand">
            still<span>.</span>
          </div>
          <span className="header-divider" />
          <div className="reader-book-title">
            <strong>{book.title}</strong>
            <small>{book.author || "慢慢读，每一页都算数。"}</small>
          </div>
        </div>
        <div className="reader-header-actions">
          <span className="reader-save-status">
            <span className="status-dot connected" />
            {saveStatus}
          </span>
          <button
            className="icon-button"
            aria-label="切换目录"
            title="目录与书签"
            aria-pressed={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            <List size={19} />
          </button>
          <button
            className={`icon-button ${currentBookmark ? "is-bookmarked" : ""}`}
            aria-label="添加书签"
            title="添加书签"
            onClick={addBookmark}
          >
            {currentBookmark ? (
              <BookmarkCheck size={19} />
            ) : (
              <Bookmark size={19} />
            )}
          </button>
          <div className="type-control">
            <button
              className={`type-button ${typographyOpen ? "active" : ""}`}
              onClick={() => setTypographyOpen(!typographyOpen)}
              aria-label="阅读外观"
              aria-expanded={typographyOpen}
            >
              Aa
            </button>
            {typographyOpen && (
              <div className="typography-popover">
                <strong>让阅读更舒服</strong>
                <label>
                  {isPdf ? "页面缩放" : "文字大小"}
                  <div>
                    <button
                      className="icon-button"
                      onClick={() =>
                        setFontSize((size) => Math.max(14, size - 2))
                      }
                      aria-label="缩小文字"
                    >
                      <Minus size={15} />
                    </button>
                    <span>{isPdf ? `${fontSize * 5}%` : `${fontSize}px`}</span>
                    <button
                      className="icon-button"
                      onClick={() =>
                        setFontSize((size) => Math.min(32, size + 2))
                      }
                      aria-label="放大文字"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </label>
                {!isPdf && (
                  <>
                    <label>
                      行间距
                      <select
                        value={lineHeight}
                        onChange={(event) =>
                          setLineHeight(Number(event.target.value))
                        }
                      >
                        <option value={1.6}>紧凑</option>
                        <option value={1.9}>舒适</option>
                        <option value={2.2}>宽松</option>
                      </select>
                    </label>
                    <div className="font-choice">
                      <button
                        className={fontFamily === "serif" ? "active" : ""}
                        onClick={() => setFontFamily("serif")}
                      >
                        Aa <span>衬线</span>
                      </button>
                      <button
                        className={fontFamily === "sans" ? "active" : ""}
                        onClick={() => setFontFamily("sans")}
                      >
                        Aa <span>简洁</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <div
        className={`reader-workspace ${sidebar ? "" : "sidebar-hidden"} ${selection ? "with-ai" : ""}`}
      >
        {sidebar && (
          <aside className="reader-sidebar">
            <div className="reader-side-tabs">
              <button
                className={sideTab === "outline" ? "active" : ""}
                onClick={() => setSideTab("outline")}
              >
                目录
              </button>
              <button
                className={sideTab === "bookmarks" ? "active" : ""}
                onClick={() => setSideTab("bookmarks")}
              >
                书签 <small>{reading.bookmarks.length}</small>
              </button>
            </div>
            <div className="reader-sidebar-content">
              {sideTab === "outline" ? (
                <>
                  <div className="outline-heading">
                    <span>
                      {book.outlineGenerated ? "AI 阅读大纲" : "CONTENTS"}
                    </span>
                    <small>{book.outline?.length || 0} 节</small>
                  </div>
                  {book.outline?.length ? (
                    <nav className="outline-list" aria-label="书籍目录">
                      {book.outline.map((item, index) => (
                        <button
                          key={item.id || index}
                          className={
                            (
                              isPdf
                                ? item.location.page === page
                                : item.location.chapterId === chapter?.id &&
                                  (reading.location?.anchor
                                    ? reading.location.anchor ===
                                      item.location.anchor
                                    : item.id ===
                                      book.outline?.find(
                                        (entry) =>
                                          entry.location.chapterId ===
                                          chapter?.id,
                                      )?.id)
                            )
                              ? "active"
                              : ""
                          }
                          style={{
                            paddingLeft: `${14 + Math.min(item.level || 0, 4) * 11}px`,
                          }}
                          onClick={() => navigate(item.location)}
                        >
                          <span>{item.title}</span>
                          {item.location.page && (
                            <small>{item.location.page}</small>
                          )}
                        </button>
                      ))}
                    </nav>
                  ) : (
                    <div className="outline-empty">
                      <List size={25} />
                      <h4>这本书没有内置目录</h4>
                      <p>
                        {book.isImageOnly
                          ? "这似乎是图片型 PDF。为避免大量图像 token 消耗，请先在本地 OCR 转成文字版，再生成大纲。"
                          : "让 AI 根据书中的文字，整理一份阅读大纲。"}
                      </p>
                      <button
                        className="secondary-button"
                        disabled={book.isImageOnly || outlineBusy}
                        onClick={() => setOutlineConfirm(true)}
                      >
                        {outlineBusy ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : (
                          <Sparkles size={15} />
                        )}
                        {outlineBusy ? "正在生成大纲…" : "智能生成大纲"}
                      </button>
                      {outlineBusy && (
                        <button
                          className="text-button"
                          onClick={() => {
                            outlineRequest.current?.abort();
                            setOutlineBusy(false);
                          }}
                        >
                          停止生成
                        </button>
                      )}
                      {outlineConfirm && (
                        <div className="outline-confirm">
                          <p>
                            将把书中抽取的文本发送给 Codex
                            生成大纲，并使用当前账号的额度。结果保存在本地
                            source 文件夹。
                          </p>
                          <button
                            className="primary-button small"
                            onClick={() => void generateOutline()}
                          >
                            开始生成
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setOutlineConfirm(false)}
                          >
                            取消
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="outline-heading">
                    <span>YOUR BOOKMARKS</span>
                    <small>{reading.bookmarks.length} 处</small>
                  </div>
                  {reading.bookmarks.length ? (
                    <div className="bookmark-list">
                      {reading.bookmarks.map((mark) => (
                        <div className="bookmark-item" key={mark.id}>
                          <button onClick={() => navigate(mark.location)}>
                            <Bookmark size={14} />
                            <span>
                              {mark.label}
                              <small>
                                {new Date(mark.createdAt).toLocaleDateString(
                                  "zh-CN",
                                )}
                              </small>
                            </span>
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`删除书签 ${mark.label}`}
                            onClick={() =>
                              setReading((current) => ({
                                ...current,
                                bookmarks: current.bookmarks.filter(
                                  (value) => value.id !== mark.id,
                                ),
                              }))
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="outline-empty">
                      <Bookmark size={25} />
                      <h4>在喜欢的地方停一停</h4>
                      <p>点击上方的书签图标，留下当前阅读位置。</p>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="reader-side-bottom">
              <span>
                READING PROGRESS
                <strong>{Math.round((reading.progress || 0) * 100)}%</strong>
              </span>
              <div className="reading-progress-track">
                <i style={{ width: `${(reading.progress || 0) * 100}%` }} />
              </div>
            </div>
          </aside>
        )}
        <section className="reading-column">
          <div
            className="reading-scroll"
            ref={scroll}
            onScroll={onReadingScroll}
          >
            <div className={`reading-paper ${isPdf ? "pdf-paper" : ""}`}>
              <div className="paper-meta">
                <span>{isPdf ? "PDF EDITION" : "ENGLISH READING"}</span>
                <span>
                  {isPdf
                    ? `${page} / ${pageCount}`
                    : `${chapterIndex + 1} / ${totalChapters}`}
                </span>
              </div>
              <div
                ref={article}
                className={`reading-content ${isPdf ? "" : "prose"} ${fontFamily === "sans" ? "prose-sans" : ""}`}
                onMouseUp={captureSelection}
                onKeyUp={(event) => {
                  if (event.key === "Shift") captureSelection();
                }}
                onTouchEnd={() => setTimeout(captureSelection, 100)}
                onClick={handleLink}
                style={
                  {
                    "--reading-size": `${fontSize}px`,
                    "--reading-line-height": lineHeight,
                  } as CSSProperties
                }
              >
                {isPdf ? (
                  <PdfReader
                    bookId={bookId}
                    page={page}
                    zoom={fontSize / 20}
                    onPageCount={setPageCount}
                  />
                ) : chapter ? (
                  <div
                    key={chapter.id}
                    dangerouslySetInnerHTML={{ __html: chapter.html }}
                  />
                ) : (
                  <div className="empty-state">
                    这本书暂时没有可显示的章节。
                  </div>
                )}
              </div>
              <div className="paper-bottom">
                <span>✳</span>
                <p>读到不熟悉的表达？选中文字，让理解更进一步。</p>
              </div>
            </div>
          </div>
          <footer className="reader-footer">
            <button
              className="text-button"
              onClick={() => step(-1)}
              disabled={isPdf ? page <= 1 : chapterIndex <= 0}
            >
              <ChevronLeft size={17} />
              <span>{isPdf ? "上一页" : "上一章"}</span>
            </button>
            {isPdf ? (
              <form
                className="page-jump"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = Number(pageInput);
                  if (Number.isInteger(value)) navigate({ page: value });
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  aria-label="跳转页码"
                />
                <span>/ {pageCount} 页</span>
                <button
                  type="submit"
                  className="icon-button"
                  title="跳转"
                  aria-label="跳转页面"
                >
                  <ArrowRight size={14} />
                </button>
              </form>
            ) : (
              <span className="chapter-footer-title">
                {chapter?.title || "阅读中"}
              </span>
            )}
            <button
              className="text-button"
              onClick={() => step(1)}
              disabled={
                isPdf ? page >= pageCount : chapterIndex >= totalChapters - 1
              }
            >
              <span>{isPdf ? "下一页" : "下一章"}</span>
              <ChevronRight size={17} />
            </button>
          </footer>
        </section>
        {selection && (
          <aside className="ai-panel">
            <header className="ai-panel-header">
              <span>
                <Sparkles size={17} />
                <strong>读懂这一处</strong>
              </span>
              <button
                className="icon-button"
                onClick={closeAI}
                aria-label="关闭 AI 解析"
              >
                <X size={18} />
              </button>
            </header>
            <div className="ai-scroll" ref={aiScroll}>
              <div className="selection-block">
                <span className="eyebrow">你选中的原文</span>
                <blockquote>{selection.text}</blockquote>
                <div className="selection-save">
                  <select
                    value={saveType}
                    onChange={(event) => {
                      setSaveType(event.target.value as ReviewType);
                      setSaved(false);
                    }}
                    aria-label="收藏分类"
                  >
                    {Object.entries(typeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-button small"
                    disabled={saving || saved}
                    onClick={() => void saveReview()}
                  >
                    {saving ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : saved ? (
                      <Check size={14} />
                    ) : (
                      <Bookmark size={14} />
                    )}
                    {saved ? "已收藏" : "收藏"}
                  </button>
                </div>
              </div>
              {messages.map((message, index) =>
                message.role === "user" ? (
                  <div className="user-message" key={index}>
                    {message.content}
                  </div>
                ) : (
                  <div className="assistant-message" key={index}>
                    <span className="assistant-label">
                      <span>✳</span> STILL · 阅读伙伴
                    </span>
                    <FormattedText text={message.content} />
                    <button
                      className="text-button save-answer"
                      disabled={saving}
                      onClick={(event) => {
                        const block = event.currentTarget.parentElement;
                        const selected = window.getSelection();
                        const selectedText =
                          selected &&
                          !selected.isCollapsed &&
                          block?.contains(selected.anchorNode) &&
                          block.contains(selected.focusNode)
                            ? selected.toString().trim()
                            : "";
                        void saveReview(selectedText || message.content);
                      }}
                    >
                      <Bookmark size={13} /> 收藏
                      {window.getSelection()?.isCollapsed
                        ? "这段解析"
                        : "解析内容"}
                    </button>
                  </div>
                ),
              )}
              {aiBusy && (
                <div className="ai-loading" role="status">
                  <span className="thinking-icon">✳</span>
                  <div>
                    <strong>正在细读这段文字…</strong>
                    <p>Codex 会结合上下文解析，通常需要一点时间。</p>
                    <button className="text-button" onClick={stopAI}>
                      停止解析
                    </button>
                  </div>
                </div>
              )}
              {aiError && (
                <div className="ai-error" role="alert">
                  <p>{aiError}</p>
                  <button
                    className="text-button"
                    onClick={() => void explain(selection, messages)}
                  >
                    重新解析 <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="ai-composer">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!question.trim() || aiBusy) return;
                  const history = [
                    ...messages,
                    { role: "user" as const, content: question.trim() },
                  ];
                  setMessages(history);
                  setQuestion("");
                  void explain(selection, history);
                }}
              >
                <textarea
                  rows={2}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="还没理解？继续问问…"
                  aria-label="向 AI 追问"
                  maxLength={4000}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  className="send-button"
                  type="submit"
                  aria-label="发送追问"
                  disabled={aiBusy || !question.trim()}
                >
                  <Send size={16} />
                </button>
              </form>
              <p>
                <span className="status-dot connected" />
                使用本机 Codex 账号额度 · 仅发送相关文本
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

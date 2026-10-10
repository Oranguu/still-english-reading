import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Folder,
  Layers3,
  Library,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  formatLabel,
  messageOf,
  typeLabels,
  type AIStatus,
  type Book,
  type ReviewItem,
  type ReviewType,
} from "./types";
import Reader from "./Reader";

type View = "library" | "review";
type Category = "all" | ReviewType | "books";
const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Browser may disable storage. */
    }
  },
};

export default function App() {
  const [view, setView] = useState<View>("library");
  const [books, setBooks] = useState<Book[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [activeBook, setActiveBook] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const [lastRead, setLastRead] = useState(
    storage.get("still:last-read") || "",
  );
  const notify = useCallback((message: string) => setToast(message), []);
  const loadReviews = useCallback(async () => {
    try {
      const result = await api<{ items: ReviewItem[] }>("/api/reviews");
      setReviews(result.items);
    } catch (error) {
      notify(messageOf(error));
    }
  }, [notify]);
  const loadBooks = useCallback(async () => {
    setRefreshing(true);
    setLoadError("");
    try {
      const result = await api<{ books: Book[] }>("/api/books");
      setBooks(result.books);
    } catch (error) {
      setLoadError(messageOf(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  const loadStatus = useCallback(() => {
    api<AIStatus>("/api/ai/status")
      .then(setStatus)
      .catch(() =>
        setStatus({
          available: false,
          authenticated: false,
          message: "暂时无法连接 Codex。请确认本地 Codex 已安装并登录。",
        }),
      );
  }, []);
  useEffect(() => {
    void loadBooks();
    void loadReviews();
    loadStatus();
  }, [loadBooks, loadReviews, loadStatus]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.title = activeBook
      ? "阅读中 · still"
      : view === "review"
        ? "复习卡片 · still"
        : "我的书库 · still";
  }, [activeBook, view]);
  function openBook(id: string) {
    setActiveBook(id);
    setLastRead(id);
    storage.set("still:last-read", id);
  }
  const connected = status?.available && status?.authenticated;

  useEffect(() => {
    const dialog = helpDialog.current;
    if (!dialog) return;
    if (helpOpen && !dialog.open) dialog.showModal();
    else if (!helpOpen && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [helpOpen]);

  return (
    <div className={`app ${activeBook ? "app-reading" : ""}`}>
      {!activeBook && (
        <aside className="app-sidebar">
          <a
            className="brand"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              setView("library");
            }}
            aria-label="still 首页"
          >
            still<span className="brand-dot">.</span>
            <small>ENGLISH READING</small>
          </a>
          <div className="sidebar-section-label">你的学习空间</div>
          <nav className="main-nav" aria-label="主导航">
            <button
              className={view === "library" ? "active" : ""}
              onClick={() => setView("library")}
            >
              <Library size={19} />
              <span>我的书库</span>
              <small>{books.length}</small>
            </button>
            <button
              className={view === "review" ? "active" : ""}
              onClick={() => {
                setView("review");
                void loadReviews();
              }}
            >
              <Layers3 size={19} />
              <span>复习卡片</span>
              <small>{reviews.length}</small>
            </button>
          </nav>
          <div className="sidebar-note">
            <span className="small-asterisk">✳</span>
            <p>
              A little reading.
              <br />A little progress.
              <br />
              <em>Every day.</em>
            </p>
            <span>每一页，都算数。</span>
          </div>
          <div className="sidebar-bottom">
            <div>
              <ShieldCheck size={15} />
              <span>本地阅读，安心收藏</span>
            </div>
            <small>书籍与学习记录保存在本机</small>
            <button
              className="quiet-button"
              aria-haspopup="dialog"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={15} /> 使用说明 <ArrowRight size={14} />
            </button>
          </div>
        </aside>
      )}
      <main className="app-main">
        {!activeBook && (
          <header className="topbar">
            <div className="breadcrumb">
              我的空间 <span>/</span>
              <strong>{view === "library" ? "书库" : "复习"}</strong>
            </div>
            <div className="topbar-actions">
              <button
                className="help-pill"
                aria-haspopup="dialog"
                onClick={() => {
                  setStatusOpen(false);
                  setHelpOpen(true);
                }}
              >
                <CircleHelp size={14} /> 使用说明
              </button>
              <button
                className="connection-pill"
                onClick={() => {
                  setStatusOpen(!statusOpen);
                  if (!statusOpen) loadStatus();
                }}
                aria-expanded={statusOpen}
              >
                <span
                  className={`status-dot ${connected ? "connected" : ""}`}
                />
                {connected
                  ? "Codex 已连接"
                  : status
                    ? "Codex 未就绪"
                    : "连接 Codex…"}
                <ChevronDown size={13} />
              </button>
            </div>
          </header>
        )}
        {statusOpen && (
          <section className="status-popover">
            <button
              className="icon-button close-status"
              aria-label="关闭连接详情"
              onClick={() => setStatusOpen(false)}
            >
              <X size={16} />
            </button>
            <Sparkles size={20} />
            <h3>你的 AI 阅读伙伴</h3>
            <p>
              {status?.message ||
                (connected
                  ? "使用本机 Codex 登录账号的现有用量。"
                  : "正在读取本地 Codex 状态…")}
            </p>
            {status?.rateLimits && (
              <div className="quota-grid">
                {Object.entries(status.rateLimits).map(
                  ([key, value]) =>
                    value && (
                      <div key={key}>
                        <small>
                          {value.windowMinutes === 10080
                            ? "每周额度剩余"
                            : value.windowMinutes === 300
                              ? "5 小时额度剩余"
                              : key === "primary"
                                ? "当前窗口剩余"
                                : "周期额度剩余"}
                        </small>
                        <strong>
                          {Math.round(value.remainingPercent)}
                          <span>%</span>
                        </strong>
                        <div className="quota-track">
                          <i style={{ width: `${value.remainingPercent}%` }} />
                        </div>
                      </div>
                    ),
                )}
              </div>
            )}
            <small>
              划词解析与生成大纲会消耗 Codex 账号用量。仅在使用 AI
              时发送相关书籍文本。
            </small>
            <button className="text-button" onClick={loadStatus}>
              <RefreshCw size={13} /> 刷新状态
            </button>
          </section>
        )}
        {activeBook ? (
          <Reader
            bookId={activeBook}
            status={status}
            onBack={() => {
              setActiveBook(null);
              void loadReviews();
            }}
            onSaved={() => void loadReviews()}
            notify={notify}
          />
        ) : view === "library" ? (
          <LibraryView
            books={books}
            loading={loading}
            refreshing={refreshing}
            error={loadError}
            refresh={loadBooks}
            openBook={openBook}
            lastRead={lastRead}
            reviewCount={reviews.length}
          />
        ) : (
          <ReviewView
            items={reviews}
            setItems={setReviews}
            notify={notify}
            openBook={openBook}
          />
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <dialog
        className="help-dialog"
        ref={helpDialog}
        aria-labelledby="help-title"
        onCancel={() => setHelpOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setHelpOpen(false);
        }}
      >
        <section
          className="help-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="icon-button modal-close"
            aria-label="关闭说明"
            onClick={() => setHelpOpen(false)}
          >
            <X size={20} />
          </button>
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h2 id="help-title">使用说明</h2>
          <div className="help-step">
            <span>01</span>
            <div>
              <h3>把书放进 source 文件夹</h3>
              <p>
                支持 PDF、EPUB 和
                Markdown，也会读取子文件夹。放好后点击「刷新书库」。
                目录可直接跳转；没有目录时可用 AI 生成大纲，图片型 PDF 除外。
              </p>
            </div>
          </div>
          <div className="help-step">
            <span>02</span>
            <div>
              <h3>用键盘，轻松翻页</h3>
              <p>
                <kbd>↑</kbd> 上一页，<kbd>↓</kbd> 下一页。EPUB / Markdown
                每次移动一屏，到章节边缘再切换章节。输入或选中文字时不会触发翻页；书签和阅读进度会自动保存。
              </p>
            </div>
          </div>
          <div className="help-step">
            <span>03</span>
            <div>
              <h3>选中文字，读懂每一处</h3>
              <p>
                选中原文会自动打开 AI 解析，可以继续追问。AI 使用本机 Codex
                登录账号的额度，需要网络连接。
              </p>
            </div>
          </div>
          <div className="help-step">
            <span>04</span>
            <div>
              <h3>把值得记住的留下</h3>
              <p>
                收藏单词、短语、句子或解析，在复习卡片中点击展开。收藏保存在工程的
                review 文件夹；进度、书签与生成的大纲保存在 source 文件夹。
              </p>
            </div>
          </div>
          <div className="info-box">
            <ShieldCheck size={18} />
            <p>
              日常阅读在本地完成。仅使用 AI 功能时，相关原文与问题会发送给 Codex
              服务。
            </p>
          </div>
          <button className="primary-button" onClick={() => setHelpOpen(false)}>
            开始阅读 <ArrowRight size={16} />
          </button>
        </section>
      </dialog>
    </div>
  );
}

function LibraryView({
  books,
  loading,
  refreshing,
  error,
  refresh,
  openBook,
  lastRead,
  reviewCount,
}: {
  books: Book[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  refresh: () => void;
  openBook: (id: string) => void;
  lastRead: string;
  reviewCount: number;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = useMemo(
    () =>
      books.filter(
        (book) =>
          (filter === "all" || book.format === filter) &&
          `${book.title} ${book.author || ""} ${book.relativePath}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [books, query, filter],
  );
  const recent = books.find((book) => book.id === lastRead);
  return (
    <div className="page-content library-content">
      <section className="library-hero">
        <div>
          <span className="eyebrow">
            <i /> A SPACE TO READ & GROW
          </span>
          <h1>
            One page
            <br />
            <em>at a time.</em>
          </h1>
          <p>让阅读慢下来，让英语一点点成为你的语言。</p>
          <div className="hero-stats">
            <span>
              <strong>{books.length.toString().padStart(2, "0")}</strong> 本藏书
            </span>
            <i />
            <span>
              <strong>{reviewCount.toString().padStart(2, "0")}</strong> 张积累
            </span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-circle" />
          <div className="art-book art-book-back">
            <span>
              THE ART
              <br />
              OF
              <br />
              NOTICING
            </span>
          </div>
          <div className="art-book art-book-front">
            <span>
              READ.
              <br />
              PAUSE.
              <br />
              <em>GROW.</em>
            </span>
            <div className="book-rule" />
            <small>A MOMENT FOR YOURSELF</small>
            <span className="cover-asterisk">✳</span>
          </div>
          <span className="art-caption">A FEW PAGES. A NEW PERSPECTIVE.</span>
        </div>
      </section>
      {recent && (
        <button className="continue-strip" onClick={() => openBook(recent.id)}>
          <span className="continue-icon">
            <BookOpen size={19} />
          </span>
          <span>
            <small>继续上次的阅读</small>
            <strong>{recent.title}</strong>
          </span>
          <span className="continue-action">
            继续阅读 <ArrowRight size={17} />
          </span>
        </button>
      )}
      <section className="books-section">
        <div className="section-heading">
          <div>
            <h2>
              我的书库 <span>{books.length}</span>
            </h2>
            <p>好书在身边，好奇心也在。</p>
          </div>
          <button
            className="secondary-button"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            {refreshing ? "正在扫描" : "刷新书库"}
          </button>
        </div>
        <div className="library-tools">
          <div className="filter-tabs" aria-label="文件格式">
            {[
              ["all", "全部"],
              ["epub", "EPUB"],
              ["pdf", "PDF"],
              ["md", "Markdown"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="search-input">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索书名、作者…"
              aria-label="搜索书库"
            />
            {query && (
              <button
                className="icon-button"
                onClick={() => setQuery("")}
                aria-label="清空搜索"
              >
                <X size={13} />
              </button>
            )}
          </label>
        </div>
        {loading ? (
          <div className="empty-state">
            <LoaderCircle size={28} className="spin" />
            <h3>正在整理你的书架…</h3>
          </div>
        ) : error ? (
          <div className="empty-state error-state">
            <Folder size={30} />
            <h3>书库暂时没有打开</h3>
            <p>{error}</p>
            <button className="secondary-button" onClick={refresh}>
              重试
            </button>
          </div>
        ) : !visible.length ? (
          <div className="empty-state">
            <BookOpen size={34} />
            <h3>
              {books.length ? "没有找到这本书" : "第一本书，从这里开始。"}
            </h3>
            <p>
              {books.length
                ? "换一个关键词，或查看其他文件格式。"
                : "将 PDF、EPUB 或 Markdown 文件放入工程的 source 文件夹，再刷新书库。"}
            </p>
            {!books.length && (
              <button className="secondary-button" onClick={refresh}>
                <RefreshCw size={15} /> 扫描本地书籍
              </button>
            )}
          </div>
        ) : (
          <div className="book-grid">
            {visible.map((book, index) => (
              <button
                className="book-card"
                key={book.id}
                onClick={() => openBook(book.id)}
                style={{ animationDelay: `${index * 65}ms` }}
              >
                <div className={`book-cover cover-${index % 4}`}>
                  <div className="cover-top">
                    <span>STILL LIBRARY</span>
                    <span>{formatLabel(book.format)}</span>
                  </div>
                  <div className="cover-title">{book.title}</div>
                  <span className="cover-bottom">
                    {book.author || "A LITTLE READING, EVERY DAY."}
                  </span>
                  <div className="cover-decoration" aria-hidden="true">
                    ✳
                  </div>
                </div>
                <div className="book-info">
                  <span className="format-badge">
                    {formatLabel(book.format)}
                  </span>
                  <h3>{book.title}</h3>
                  <p>{book.author || "本地藏书"}</p>
                  <div className="book-info-bottom">
                    <span>
                      {book.id === lastRead ? "上次阅读" : "等待翻开"}
                    </span>
                    <span className="book-open-arrow">
                      <ArrowRight size={17} />
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
      <footer className="library-footer">
        <Folder size={14} />
        <span>从本地 source 文件夹读取 · 书籍不会自动上传</span>
        <span className="footer-sign">Enjoy the process.</span>
      </footer>
    </div>
  );
}

function ReviewView({
  items,
  setItems,
  notify,
  openBook,
}: {
  items: ReviewItem[];
  setItems: React.Dispatch<React.SetStateAction<ReviewItem[]>>;
  notify: (message: string) => void;
  openBook: (id: string) => void;
}) {
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [bookFilter, setBookFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState("");
  const [busy, setBusy] = useState("");
  const sources = useMemo(
    () =>
      Array.from(
        new Map(items.map((item) => [item.bookId, item.bookTitle])).entries(),
      ),
    [items],
  );
  const filtered = items.filter(
    (item) =>
      (category === "all" || category === "books" || category === item.type) &&
      (!bookFilter || item.bookId === bookFilter) &&
      `${item.text} ${item.note || ""} ${item.bookTitle}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function reviewed(item: ReviewItem) {
    setBusy(item.id);
    try {
      const result = await api<{ item: ReviewItem }>(
        `/api/reviews/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ reviewedAt: new Date().toISOString() }),
        },
      );
      setItems((current) =>
        current.map((value) => (value.id === item.id ? result.item : value)),
      );
      notify("已记录这次复习。");
    } catch (error) {
      notify(messageOf(error));
    } finally {
      setBusy("");
    }
  }
  async function remove(id: string) {
    setBusy(id);
    try {
      await api(`/api/reviews/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((value) => value.id !== id));
      setDeleting("");
      notify("卡片已删除。");
    } catch (error) {
      notify(messageOf(error));
    } finally {
      setBusy("");
    }
  }
  const renderCard = (item: ReviewItem) => (
    <article
      className={`review-card ${expanded.has(item.id) ? "expanded" : ""}`}
      key={item.id}
    >
      <button
        className="review-card-summary"
        onClick={() => toggle(item.id)}
        aria-expanded={expanded.has(item.id)}
      >
        <span className={`review-type type-${item.type}`}>
          {typeLabels[item.type]}
        </span>
        <span className="review-preview">
          <strong>{item.text}</strong>
          <small>{item.bookTitle}</small>
        </span>
        <span className="review-date">
          {item.reviewedAt ? "已复习" : "待复习"}
        </span>
        <ChevronDown className="expand-icon" size={17} />
      </button>
      {expanded.has(item.id) && (
        <div className="review-card-body">
          <div className="review-original">{item.text}</div>
          {item.note ? (
            <div className="review-note">
              <span className="eyebrow">解析 & 笔记</span>
              <FormattedText text={item.note} />
            </div>
          ) : (
            <div className="review-note muted">
              这张卡片还没有解析。可以回到书中选中文字，请 AI 帮你理解。
            </div>
          )}
          {item.context && item.context !== item.text && (
            <details className="context-details">
              <summary>
                查看原文语境 <ChevronDown size={14} />
              </summary>
              <blockquote>{item.context}</blockquote>
            </details>
          )}
          <div className="review-card-actions">
            <button
              className="text-button"
              onClick={() => openBook(item.bookId)}
            >
              <BookOpen size={14} /> 回到来源书籍
            </button>
            <div>
              {deleting === item.id ? (
                <span className="delete-confirm">
                  <span>删除这张卡片？</span>
                  <button
                    onClick={() => void remove(item.id)}
                    disabled={busy === item.id}
                  >
                    确认
                  </button>
                  <button onClick={() => setDeleting("")}>取消</button>
                </span>
              ) : (
                <button
                  className="icon-button"
                  aria-label="删除卡片"
                  onClick={() => setDeleting(item.id)}
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                className="secondary-button small"
                onClick={() => void reviewed(item)}
                disabled={busy === item.id}
              >
                {busy === item.id ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}{" "}
                我复习过了
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
  return (
    <div className="page-content review-content">
      <section className="review-hero">
        <span className="eyebrow">WORDS WORTH KEEPING</span>
        <h1>
          A little more
          <br />
          <em>familiar.</em>
        </h1>
        <p>从似曾相识，到真正掌握。今天也温习一点。</p>
        <div className="review-total">
          <strong>{items.length.toString().padStart(2, "0")}</strong>
          <span>
            张知识卡片
            <small>
              {items.filter((item) => item.reviewedAt).length} 张已复习
            </small>
          </span>
        </div>
      </section>
      <div className="section-heading">
        <h2>我的积累</h2>
        <span className="collapse-hint">
          <ArrowDown size={14} /> 点击卡片，展开解析
        </span>
      </div>
      <div className="review-tools">
        <div className="filter-tabs">
          <button
            className={category === "all" ? "active" : ""}
            onClick={() => setCategory("all")}
          >
            全部 <small>{items.length}</small>
          </button>
          {Object.entries(typeLabels).map(([key, label]) => (
            <button
              key={key}
              className={category === key ? "active" : ""}
              onClick={() => setCategory(key as Category)}
            >
              {label}{" "}
              <small>{items.filter((item) => item.type === key).length}</small>
            </button>
          ))}
          <button
            className={category === "books" ? "active" : ""}
            onClick={() => setCategory("books")}
          >
            来源书籍
          </button>
        </div>
        <div className="review-filters">
          <label className="search-input">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="找一个单词、一段灵感…"
              aria-label="搜索复习卡片"
            />
          </label>
          <select
            value={bookFilter}
            onChange={(event) => setBookFilter(event.target.value)}
            aria-label="按来源书籍筛选"
          >
            <option value="">所有书籍</option>
            {sources.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!filtered.length ? (
        <div className="empty-state">
          <Bookmark size={32} />
          <h3>
            {items.length ? "没有找到相关卡片" : "把想记住的，留在这里。"}
          </h3>
          <p>
            {items.length
              ? "试试其他关键词或来源书籍。"
              : "阅读时选中单词、短语或句子，点击收藏。它们会在这里等你重温。"}
          </p>
        </div>
      ) : category === "books" ? (
        <div className="review-groups">
          {sources.map(([id, title]) => {
            const group = filtered.filter((item) => item.bookId === id);
            return group.length ? (
              <section key={id}>
                <h3 className="source-heading">
                  <BookOpen size={17} />
                  {title}
                  <span>{group.length}</span>
                </h3>
                {group.map(renderCard)}
              </section>
            ) : null;
          })}
        </div>
      ) : (
        <div className="review-list">{filtered.map(renderCard)}</div>
      )}
      <footer className="library-footer">
        <ShieldCheck size={14} />
        <span>这些积累保存在本地 review 文件夹。</span>
        <span className="footer-sign">Make it yours.</span>
      </footer>
    </div>
  );
}

export function FormattedText({ text }: { text: string }) {
  return (
    <div className="formatted-text">
      {text.split("\n").map((line, index) => {
        const heading = line.match(/^#{1,4}\s+(.+)/);
        const pieces = (heading ? heading[1] : line)
          .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
          .map((part, partIndex) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <strong key={partIndex}>{part.slice(2, -2)}</strong>
            ) : part.startsWith("`") && part.endsWith("`") ? (
              <code key={partIndex}>{part.slice(1, -1)}</code>
            ) : (
              part
            ),
          );
        return heading ? (
          <h4 key={index}>{pieces}</h4>
        ) : !line.trim() ? (
          <div className="paragraph-space" key={index} />
        ) : (
          <p key={index}>{pieces}</p>
        );
      })}
    </div>
  );
}

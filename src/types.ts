export type BookFormat = "pdf" | "epub" | "md";
export type ReviewType = "word" | "phrase" | "sentence";
export interface Location {
  page?: number;
  chapterId?: string;
  anchor?: string;
  scrollRatio?: number;
}
export interface OutlineItem {
  id: string;
  title: string;
  level: number;
  location: Location;
}
export interface Chapter {
  id: string;
  title: string;
  html: string;
  location: Location;
}
export interface Book {
  id: string;
  title: string;
  author?: string;
  format: BookFormat;
  relativePath: string;
  size: number;
  outline?: OutlineItem[];
  chapters?: Chapter[];
  pageCount?: number;
  isImageOnly?: boolean;
  outlineGenerated?: boolean;
}
export interface Bookmark {
  id: string;
  label: string;
  location: Location;
  createdAt: string;
}
export interface ReadingState {
  location?: Location;
  progress?: number;
  bookmarks: Bookmark[];
}
export interface ReviewItem {
  id: string;
  bookId: string;
  bookTitle: string;
  type: ReviewType;
  text: string;
  note?: string;
  context?: string;
  location?: Location;
  createdAt: string;
  reviewedAt?: string;
}
export interface Message {
  role: "user" | "assistant";
  content: string;
}
export interface RateWindow {
  remainingPercent: number;
  resetAt?: number;
  windowMinutes?: number;
}
export interface AIStatus {
  available: boolean;
  authenticated: boolean;
  accountType?: string;
  message?: string;
  rateLimits?: { primary?: RateWindow; secondary?: RateWindow };
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("服务暂时无法响应，请确认本地工具已启动。");
  }
  if (!response.ok) throw new Error(data.error || "操作失败，请稍后重试。");
  return data as T;
}
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "发生了意外错误，请重试。";
}
export function locationLabel(location?: Location) {
  return location?.page ? `第 ${location.page} 页` : "阅读位置";
}
export function inferType(text: string): ReviewType {
  const words = text.trim().split(/\s+/).length;
  return words === 1
    ? "word"
    : words <= 6 && !/[.!?。！？]/.test(text)
      ? "phrase"
      : "sentence";
}
export const typeLabels: Record<ReviewType, string> = {
  word: "单词",
  phrase: "短语",
  sentence: "句子",
};
export const formatLabel = (format: BookFormat) =>
  format === "md" ? "MARKDOWN" : format.toUpperCase();

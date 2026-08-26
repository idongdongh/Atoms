import { useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  FileCode2,
  Globe,
  History,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, generateCuteAppName } from "@/lib/utils";
import type {
  AgentEvent,
  AgentRun,
  ChatMessage,
  FileContent,
  FileEntry,
  Project,
  ProjectPublication,
  ProjectPreview,
  ProjectRelease,
  ProjectVersion,
  User,
} from "@atoms/contracts";

type PublicationView = ProjectPublication & { baseUrl: string | null };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  if (method !== "GET" && method !== "HEAD") {
    headers.set("x-atoms-client", "web");
  }
  const response = await fetch(url, { ...init, method, headers });
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "请求失败，请稍后重试");
  return body;
}

// crypto.randomUUID() requires a secure context, which a plain-HTTP
// deployment (http://<server-ip>) is not; getRandomValues works everywhere.
function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function failureText(run: AgentRun): string {
  switch (run.errorCode) {
    case "max_steps":
      return "Agent 达到了工具调用步数上限，任务太大了——可以拆成两条消息发，或直接重试";
    case "run_timeout":
      return "这次生成超过了时间预算被中止，直接重试通常就能完成";
    case "no_changes":
      return "Agent 没有产生任何修改";
    case "worker_interrupted":
      return "服务重启打断了这次生成，请重试";
    default:
      return `生成失败：${run.errorMessage ?? run.errorCode ?? "未知错误"}`;
  }
}

function QrCard({ url }: { url: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 180, margin: 1 })
      .then((result) => {
        if (!cancelled) setDataUrl(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!dataUrl) return null;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5 rounded-lg border border-border bg-white p-2.5">
      <img src={dataUrl} alt="发布链接二维码" className="size-[124px]" />
      <span className="text-[10px] text-muted-foreground">扫码在手机打开</span>
      <a
        href={dataUrl}
        download="atoms-published-qr.png"
        className="text-[10px] text-primary hover:underline"
      >
        下载二维码
      </a>
    </div>
  );
}

const terminalStatuses = new Set<AgentRun["status"]>([
  "succeeded",
  "failed",
  "cancelled",
]);
const eventTypes: AgentEvent["type"][] = [
  "run.started",
  "message.delta",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "tool.failed",
  "files.changed",
  "validation.started",
  "validation.completed",
  "build.log",
  "preview.starting",
  "preview.ready",
  "preview.failed",
  "run.completed",
  "run.failed",
  "run.cancelled",
];

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "run.started":
      return "Agent 已开始执行";
    case "message.delta":
      return event.delta;
    case "tool.started":
      return `调用 ${event.toolName}`;
    case "tool.completed":
      return "工具执行完成";
    case "tool.failed":
      return `工具失败：${event.error}`;
    case "files.changed":
      return `已修改 ${event.paths.length} 个文件`;
    case "preview.starting":
      return "正在启动 Preview";
    case "preview.ready":
      return "Preview 已就绪";
    case "preview.failed":
      return `Preview 启动失败：${event.error}`;
    case "run.completed":
      return `已提交版本 ${event.commitHash.slice(0, 8)}`;
    case "run.failed":
      return `Run 失败：${event.message}`;
    case "run.cancelled":
      return "Run 已取消";
    case "tool.progress":
      return event.message;
    case "validation.started":
      return `开始 ${event.command}`;
    case "validation.completed":
      return `${event.command} ${event.success ? "通过" : "失败"}`;
    case "build.log":
      return event.message;
  }
}

// Consecutive tool events collapse into one summary row with a disclosure
// toggle, so a twelve-step build does not flood the chat feed.
function ToolCallGroup({ events }: { events: AgentEvent[] }) {
  const [open, setOpen] = useState(false);
  const failed = events.some((event) => event.type.includes("failed"));
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex cursor-pointer items-center gap-1 rounded-md text-xs transition-colors hover:text-foreground",
          failed ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        工具调用 · {events.length} 步
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 border-l border-border pl-3">
          {events.map((event) => (
            <div
              key={`${event.runId}-${event.sequence}`}
              className={cn(
                "text-xs leading-relaxed",
                event.type.includes("failed")
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {eventLabel(event)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Deterministic pastel gradients for app avatars (Dyad AppAvatar style). */
const avatarPalettes: ReadonlyArray<readonly [string, string]> = [
  ["#fecaca", "#fda4af"],
  ["#fed7aa", "#fdba74"],
  ["#fef08a", "#fde047"],
  ["#bbf7d0", "#86efac"],
  ["#bfdbfe", "#93c5fd"],
  ["#ddd6fe", "#c4b5fd"],
  ["#f5d0fe", "#e879f9"],
  ["#e2e8f0", "#cbd5e1"],
];

function avatarStyle(projectId: string): { background: string } {
  let sum = 0;
  for (const ch of projectId) sum += ch.charCodeAt(0);
  const [from, to] = avatarPalettes[sum % avatarPalettes.length]!;
  return { background: `linear-gradient(135deg, ${from}, ${to})` };
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "A";
  return [...trimmed][0]!.toUpperCase();
}

const inspirationPrompts: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: "📋 任务管理面板",
    prompt: "做一个任务管理面板，支持添加、完成和删除任务，带统计",
  },
  {
    label: "🧮 记账小应用",
    prompt: "做一个简洁的记账应用，可以记录支出并显示总金额",
  },
  {
    label: "🎯 习惯打卡",
    prompt: "做一个每日习惯打卡应用，连续天数用进度条展示",
  },
  {
    label: "🎙️ 问答卡片",
    prompt: "做一个问答卡片应用，可以翻面查看答案并标记记住/没记住",
  },
  {
    label: "🛒 购物清单",
    prompt: "做一个购物清单应用，支持勾选已买和按类别分组",
  },
  {
    label: "⏱️ 番茄钟",
    prompt: "做一个番茄钟应用，有 25 分钟计时和休息切换提示",
  },
];

export function App() {
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [releases, setReleases] = useState<ProjectRelease[]>([]);
  const [publication, setPublication] = useState<PublicationView | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [rightTab, setRightTab] = useState<
    "preview" | "files" | "code" | "publish"
  >("preview");
  const [showVersions, setShowVersions] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const previewPanelRef = useRef<ImperativePanelHandle>(null);
  const [promptIdeas, setPromptIdeas] = useState(() =>
    [...inspirationPrompts].sort(() => 0.5 - Math.random()).slice(0, 3),
  );
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [activeFile, setActiveFile] = useState<FileContent | null>(null);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready">("loading");
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected =
    projects.find((project) => project.id === selectedId) ?? null;

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages, events]);

  useEffect(() => {
    void requestJson<{ user: User }>("/api/auth/me")
      .then(({ user }) => setAuthUser(user))
      .catch(() => setAuthUser(null));
  }, []);

  useEffect(() => {
    if (!authUser) return;
    void requestJson<{ projects: Project[] }>("/api/projects")
      .then(({ projects: loaded }) => {
        setProjects(loaded);
        // Land on the home screen like Dyad's "/" route; selecting a project
        // from the sidebar opens its chat page.
        setSelectedId(null);
        setState("ready");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "项目加载失败");
        setState("ready");
      });
  }, [authUser]);

  useEffect(() => {
    if (!selectedId) {
      setFiles([]);
      setVersions([]);
      setMessages([]);
      setPreview(null);
      setReleases([]);
      setPublication(null);
      setActiveFile(null);
      setActiveRun(null);
      setShowVersions(false);
      return;
    }
    const project = projects.find((item) => item.id === selectedId);
    if (!project) return;
    setError(null);
    setActiveFile(null);
    setEvents([]);
    void Promise.all([
      requestJson<{ files: FileEntry[] }>(`/api/projects/${selectedId}/files`),
      requestJson<{ versions: ProjectVersion[] }>(
        `/api/projects/${selectedId}/versions`,
      ),
      requestJson<{ preview: ProjectPreview | null }>(
        `/api/projects/${selectedId}/preview`,
      ),
      requestJson<{ messages: ChatMessage[] }>(
        `/api/chats/${project.chatId}/messages`,
      ),
      requestJson<{ runs: AgentRun[] }>(`/api/chats/${project.chatId}/runs`),
      requestJson<{
        releases: ProjectRelease[];
        publication: PublicationView | null;
      }>(`/api/projects/${selectedId}/releases`),
    ])
      .then(
        ([
          fileResult,
          versionResult,
          previewResult,
          messageResult,
          runResult,
          releaseResult,
        ]) => {
          setFiles(fileResult.files);
          setVersions(versionResult.versions);
          setPreview(previewResult.preview);
          setMessages(messageResult.messages);
          setReleases(releaseResult.releases);
          setPublication(releaseResult.publication);
          setActiveRun(
            runResult.runs.find((run) => !terminalStatuses.has(run.status)) ??
              null,
          );
        },
      )
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "项目内容加载失败"),
      );
  }, [selectedId, projects]);

  useEffect(() => {
    if (!activeRun || terminalStatuses.has(activeRun.status)) return;
    const source = new EventSource(`/api/runs/${activeRun.id}/events/stream`);
    let sawTerminalEvent = false;
    const onEvent = (rawEvent: Event) => {
      try {
        const event = JSON.parse(
          (rawEvent as MessageEvent<string>).data,
        ) as AgentEvent;
        setEvents((current) =>
          current.some((item) => item.sequence === event.sequence)
            ? current
            : [...current, event],
        );
        if (event.type === "preview.ready") {
          void requestJson<{ preview: ProjectPreview | null }>(
            `/api/projects/${selectedId}/preview`,
          )
            .then((result) => setPreview(result.preview))
            .catch(() => undefined);
        }
        if (
          event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.cancelled"
        ) {
          sawTerminalEvent = true;
          void requestJson<{ run: AgentRun; messages: ChatMessage[] }>(
            `/api/runs/${activeRun.id}`,
          )
            .then((result) => {
              setActiveRun(result.run);
              setMessages(result.messages);
              if (!selectedId) return null;
              return Promise.all([
                requestJson<{ files: FileEntry[] }>(
                  `/api/projects/${selectedId}/files`,
                ),
                requestJson<{ versions: ProjectVersion[] }>(
                  `/api/projects/${selectedId}/versions`,
                ),
                requestJson<{ preview: ProjectPreview | null }>(
                  `/api/projects/${selectedId}/preview`,
                ),
              ]);
            })
            .then((result) => {
              if (!result) return;
              setFiles(result[0].files);
              setVersions(result[1].versions);
              setPreview(result[2].preview);
              setSending(false);
            })
            .catch((cause: unknown) => {
              setSending(false);
              setError(
                cause instanceof Error ? cause.message : "Run 状态加载失败",
              );
            });
        }
      } catch {
        setError("收到无法解析的 Agent 事件");
      }
    };
    for (const type of eventTypes) source.addEventListener(type, onEvent);
    source.onerror = () => {
      // The server closes the stream once the run reaches a terminal state;
      // that normal close must not surface as a reconnect warning.
      if (sawTerminalEvent) return;
      setError("事件连接暂时中断，正在等待重连");
    };
    return () => {
      for (const type of eventTypes) source.removeEventListener(type, onEvent);
      source.close();
    };
  }, [activeRun, selectedId]);

  useEffect(() => {
    if (!selectedId || preview?.status !== "starting") return;
    const timer = window.setInterval(() => {
      void requestJson<{ preview: ProjectPreview | null }>(
        `/api/projects/${selectedId}/preview`,
      ).then((result) => setPreview(result.preview));
    }, 500);
    return () => window.clearInterval(timer);
  }, [selectedId, preview?.status]);

  async function createProjectWithName(
    projectName: string,
  ): Promise<Project | null> {
    if (creating) return null;
    setCreating(true);
    setError(null);
    try {
      const { project } = await requestJson<{ project: Project }>(
        "/api/projects",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: projectName }),
        },
      );
      setProjects((current) => [project, ...current]);
      setSelectedId(project.id);
      return project;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目创建失败");
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function openFile(filePath: string) {
    if (!selectedId) return;
    try {
      const { file } = await requestJson<{ file: FileContent }>(
        `/api/projects/${selectedId}/files/content?path=${encodeURIComponent(filePath)}`,
      );
      setActiveFile(file);
      setRightTab("code");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件读取失败");
    }
  }

  // Re-run the last user prompt of the selected chat with a fresh
  // idempotency key; used by the failure card's retry button.
  async function retryLastPrompt() {
    if (!selected || sending) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setSending(true);
    setEvents([]);
    setError(null);
    try {
      const { run } = await requestJson<{ run: AgentRun }>(
        `/api/chats/${selected.chatId}/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: lastUser.content,
            idempotencyKey: randomId(),
          }),
        },
      );
      setActiveRun(run);
    } catch (cause) {
      setSending(false);
      setError(cause instanceof Error ? cause.message : "重试失败");
    }
  }

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || sending) return;
    setSending(true);
    setEvents([]);
    setError(null);
    try {
      let chatId = selected?.chatId;
      if (!chatId) {
        // Dyad-style first prompt: sending an idea creates the app. The
        // prompt (truncated) becomes the title, so it reads naturally in
        // the user's language instead of a random English codename.
        const title =
          prompt.trim().replace(/\s+/g, " ").slice(0, 40) ||
          generateCuteAppName();
        const project = await createProjectWithName(title);
        if (!project) {
          setSending(false);
          return;
        }
        chatId = project.chatId;
      }
      const { run } = await requestJson<{ run: AgentRun }>(
        `/api/chats/${chatId}/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            idempotencyKey: randomId(),
          }),
        },
      );
      setPrompt("");
      setActiveRun(run);
    } catch (cause) {
      setSending(false);
      setError(cause instanceof Error ? cause.message : "Run 创建失败");
    }
  }

  async function cancelRun() {
    if (!activeRun) return;
    try {
      const { run } = await requestJson<{ run: AgentRun }>(
        `/api/runs/${activeRun.id}/cancel`,
        { method: "POST" },
      );
      setActiveRun(run);
      setSending(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消失败");
    }
  }

  async function restoreVersion(version: ProjectVersion) {
    if (!selected || version.commitHash === selected.currentCommit) return;
    try {
      const { project } = await requestJson<{ project: Project }>(
        `/api/projects/${selected.id}/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commitHash: version.commitHash }),
        },
      );
      setProjects((current) =>
        current.map((item) => (item.id === project.id ? project : item)),
      );
      setActiveFile(null);
      setFiles(
        (
          await requestJson<{ files: FileEntry[] }>(
            `/api/projects/${selected.id}/files`,
          )
        ).files,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "版本恢复失败");
    }
  }

  async function publishProject() {
    if (!selected || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const result = await requestJson<{
        release: ProjectRelease;
        publication: PublicationView;
      }>(`/api/projects/${selected.id}/releases`, { method: "POST" });
      setReleases((current) => [result.release, ...current]);
      setPublication(result.publication);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发布失败");
      try {
        const refreshed = await requestJson<{
          releases: ProjectRelease[];
          publication: PublicationView | null;
        }>(`/api/projects/${selected.id}/releases`);
        setReleases(refreshed.releases);
        setPublication(refreshed.publication);
      } catch {
        // keep the inline error above
      }
    } finally {
      setPublishing(false);
    }
  }

  async function activateRelease(release: ProjectRelease) {
    if (!selected || release.id === publication?.currentReleaseId) return;
    try {
      const result = await requestJson<{ publication: PublicationView }>(
        `/api/projects/${selected.id}/releases/${release.id}/activate`,
        { method: "POST" },
      );
      setPublication(result.publication);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "切换版本失败");
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setError(null);
    try {
      const { user } = await requestJson<{ user: User }>(
        authMode === "register" ? "/api/auth/register" : "/api/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            authMode === "register"
              ? { name: authName, email: authEmail, password: authPassword }
              : { email: authEmail, password: authPassword },
          ),
        },
      );
      setAuthUser(user);
      setAuthPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败，请重试");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
    } catch {
      // signing out locally even if the request fails
    }
    setAuthUser(null);
    setProjects([]);
    setSelectedId(null);
    setEvents([]);
    setMessages([]);
    setPreview(null);
    setState("idle");
  }

  async function deleteProject(project: Project) {
    if (
      !window.confirm(
        `删除应用「${project.name}」？代码版本和发布记录将一并移除。`,
      )
    )
      return;
    try {
      await requestJson(`/api/projects/${project.id}`, { method: "DELETE" });
      setProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );
      if (selectedId === project.id) {
        setSelectedId(null);
        setPreview(null);
        setFiles([]);
        setVersions([]);
        setMessages([]);
        setActiveFile(null);
        setActiveRun(null);
        setEvents([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  if (authUser === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        正在检查登录状态…
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              {authMode === "register" ? "创建账号开始构建" : "欢迎回来"}
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              注册后即可创建应用，通过 Agent 生成、预览并发布。
            </p>
          </div>
          <form
            onSubmit={submitAuth}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-(--background-lighter) p-5 shadow-sm"
          >
            {authMode === "register" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="auth-name" className="text-sm font-medium">
                  名称
                </label>
                <Input
                  id="auth-name"
                  value={authName}
                  onChange={(event) => setAuthName(event.target.value)}
                  maxLength={80}
                  required
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="auth-email" className="text-sm font-medium">
                邮箱
              </label>
              <Input
                id="auth-email"
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="auth-password" className="text-sm font-medium">
                密码
              </label>
              <Input
                id="auth-password"
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                minLength={authMode === "register" ? 8 : undefined}
                required
                autoComplete={
                  authMode === "register" ? "new-password" : "current-password"
                }
              />
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <div className="mt-1 flex gap-2">
              <Button type="submit" className="flex-1" disabled={authBusy}>
                {authBusy
                  ? "提交中…"
                  : authMode === "register"
                    ? "注册并开始"
                    : "登录"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAuthMode(authMode === "register" ? "login" : "register");
                  setError(null);
                }}
              >
                {authMode === "register" ? "已有账号？登录" : "没有账号？注册"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const running = activeRun && !terminalStatuses.has(activeRun.status);

  const composer = (
    <form onSubmit={sendPrompt} className="p-2 pt-0">
      <div className="rounded-2xl border border-border bg-(--background-lighter) transition-colors duration-200 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20">
        <label htmlFor="agent-prompt" className="sr-only">
          告诉 Agent 你想构建什么
        </label>
        <textarea
          id="agent-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="让 Agent 构建或修改你的应用…"
          disabled={!!sending}
          className="min-h-[44px] w-full resize-none overflow-y-auto px-3 pb-2 pt-3 text-[15px] outline-none placeholder:text-muted-foreground disabled:opacity-50"
          rows={2}
        />
        <div className="flex items-center justify-end gap-1 px-2 pb-1.5">
          {running && (
            <button
              type="button"
              onClick={() => void cancelRun()}
              aria-label="取消"
              className="rounded-lg p-2 text-muted-foreground transition-colors duration-150 hover:text-destructive"
            >
              <Square className="size-5" />
            </button>
          )}
          <button
            type="submit"
            aria-label="发送"
            disabled={!prompt.trim() || !!sending}
            className="rounded-lg p-2 text-muted-foreground transition-colors duration-150 hover:text-primary disabled:opacity-30"
          >
            <SendHorizontal className="size-5" />
          </button>
        </div>
      </div>
    </form>
  );

  // Dyad-style home screen: the landing page before the first prompt.
  const homeScreen = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center p-8">
        <h1 className="text-center text-4xl font-semibold tracking-tight">
          你想构建什么？
        </h1>
        <p className="mt-3 text-center text-base leading-7 text-muted-foreground">
          描述你的想法，Atoms 会把它变成一个可运行的应用。
        </p>
        <div className="mt-6 w-full">{composer}</div>
        {sending && (
          <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="size-6 animate-spin rounded-full border-4 border-border border-t-primary" />
            正在创建应用，这可能需要一点时间…
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {promptIdeas.map((item) => (
            <button
              type="button"
              key={item.label}
              onClick={() => setPrompt(item.prompt)}
              className="flex items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              setPromptIdeas(
                [...inspirationPrompts]
                  .sort(() => 0.5 - Math.random())
                  .slice(0, 3),
              )
            }
            className="flex items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-4" />
            换一批
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-border bg-(--sidebar) text-sidebar-foreground transition-all",
          sidebarCollapsed ? "w-14" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1 px-2 py-2.5",
            sidebarCollapsed && "justify-center",
          )}
        >
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="展开侧栏"
              title="展开侧栏"
              className="group grid size-7 place-items-center rounded-md border border-transparent bg-primary text-[13px] font-bold text-primary-foreground transition-all duration-200 hover:rounded-full hover:border-(--border) hover:bg-background hover:text-foreground"
            >
              <span className="col-start-1 row-start-1 transition-opacity group-hover:opacity-0">
                A
              </span>
              <PanelLeftOpen className="col-start-1 row-start-1 size-4 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex min-w-0 items-center gap-2 pl-1 font-semibold"
                aria-label="回到主页"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">
                  A
                </span>
                <span className="truncate">Atoms</span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="收起侧栏"
                onClick={() => setSidebarCollapsed(true)}
                className="ml-auto text-sidebar-foreground hover:bg-sidebar-accent/60"
              >
                <PanelLeftClose className="size-4" />
              </Button>
            </>
          )}
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={cn(
              "flex w-full items-center rounded-md text-left",
              sidebarCollapsed ? "justify-center p-2" : "gap-2 px-2 py-2",
              !selected
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent/60",
            )}
            title="主页"
          >
            <Home className="size-4 shrink-0" />
            {!sidebarCollapsed && <span className="text-sm">主页</span>}
          </button>
          {!sidebarCollapsed && (
            <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">
              应用 · {projects.length}
            </p>
          )}
          {state === "loading" && !sidebarCollapsed && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              正在加载项目…
            </p>
          )}
          {state === "ready" && projects.length === 0 && !sidebarCollapsed && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              在主页描述一个想法，就能创建你的第一个应用。
            </p>
          )}
          {projects.map((project) => (
            <div key={project.id} className="group relative">
              <button
                type="button"
                onClick={() => setSelectedId(project.id)}
                title={project.name}
                className={cn(
                  "flex w-full items-center justify-start rounded-md text-left",
                  sidebarCollapsed
                    ? "justify-center p-2"
                    : "gap-2 py-2 pl-2 pr-8",
                  project.id === selectedId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60",
                )}
              >
                {sidebarCollapsed ? (
                  // The narrow rail needs a visible target per project.
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-md text-[10px] font-semibold"
                    style={avatarStyle(project.id)}
                    aria-hidden="true"
                  >
                    {initials(project.name)}
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-col py-1">
                    <span className="truncate text-sm">{project.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {project.currentCommit.slice(0, 7)}
                    </span>
                  </span>
                )}
              </button>
              {!sidebarCollapsed && (
                <button
                  type="button"
                  aria-label={`删除应用 ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteProject(project);
                  }}
                  className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </nav>
        <div
          className={cn(
            "flex items-center gap-2 border-t border-border p-2",
            sidebarCollapsed && "justify-center",
          )}
        >
          {!sidebarCollapsed && (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {authUser.email}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="退出登录"
            onClick={() => void logout()}
            className="text-sidebar-foreground hover:bg-sidebar-accent/60"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {!selected || messages.length === 0 ? (
          homeScreen
        ) : (
          <PanelGroup direction="horizontal" className="min-h-0 flex-1">
            <Panel
              ref={chatPanelRef}
              defaultSize={46}
              minSize={28}
              collapsible
              onCollapse={() => setChatCollapsed(true)}
              onExpand={() => setChatCollapsed(false)}
              className="min-w-0"
            >
              <div className="flex h-full min-w-0 flex-col">
                <header className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5 pt-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Project
                    </p>
                    <h1 className="truncate text-[15px] font-semibold leading-tight">
                      {selected.name}
                    </h1>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                      <span className="size-1.5 rounded-full bg-green-500" />
                      {running
                        ? `Agent ${activeRun?.status}`
                        : activeRun?.status === "failed"
                          ? "Needs attention"
                          : "Ready"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        showVersions && "bg-primary/10 text-primary",
                      )}
                      onClick={() => setShowVersions((open) => !open)}
                    >
                      <History className="size-4" />
                      版本 {versions.length}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={previewCollapsed ? "展开预览" : "收起预览"}
                      className={cn(
                        previewCollapsed && "bg-primary/10 text-primary",
                      )}
                      onClick={() => {
                        const panel = previewPanelRef.current;
                        if (!panel) return;
                        if (previewCollapsed) panel.expand();
                        else panel.collapse();
                      }}
                    >
                      {previewCollapsed ? (
                        <PanelRightOpen className="size-5" />
                      ) : (
                        <PanelRightClose className="size-5" />
                      )}
                    </Button>
                  </div>
                </header>
                {error && (
                  <p
                    role="alert"
                    className="mx-3 mb-2 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}
                {showVersions ? (
                  <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
                    <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background px-3 py-2">
                      <h2 className="pl-1 text-base font-medium">
                        Version History
                      </h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowVersions(false)}
                      >
                        关闭
                      </Button>
                    </div>
                    {versions.map((version, index) => (
                      <div
                        key={version.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2",
                          version.commitHash === selected.currentCommit &&
                            "bg-(--background-lightest)",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold">
                            Version {versions.length - index}（
                            {version.commitHash.slice(0, 7)}）
                          </p>
                          <p
                            className="truncate font-mono text-[11px] text-muted-foreground"
                            title={version.message}
                          >
                            {version.message}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={
                            version.commitHash === selected.currentCommit
                          }
                          onClick={() => void restoreVersion(version)}
                          className="shrink-0 rounded-md bg-(--primary) px-2 py-1 text-sm font-medium text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                          {version.commitHash === selected.currentCommit
                            ? "当前"
                            : "恢复"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    ref={feedRef}
                    className="scrollbar-on-hover min-h-0 flex-1 overflow-y-auto px-4"
                  >
                    <div className="mx-auto flex w-full max-w-3xl flex-col py-2">
                      {messages.map((message) =>
                        message.role === "user" ? (
                          <div
                            key={message.id}
                            className="mt-2 flex justify-end"
                          >
                            <div className="ml-24 rounded-lg bg-(--sidebar-accent) p-2 text-[15px] leading-relaxed">
                              {message.content}
                            </div>
                          </div>
                        ) : (
                          <div key={message.id} className="mt-2 w-full">
                            <p className="mb-0.5 text-[10px] font-semibold text-muted-foreground">
                              Agent
                            </p>
                            <div className="prose prose-sm dark:prose-invert max-w-none break-words text-[15px] leading-relaxed">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        ),
                      )}
                      {(() => {
                        // Build the activity feed: streaming deltas merge into
                        // narration paragraphs (styled like speech), runs of
                        // tool events collapse into disclosure groups, and the
                        // remaining status events stay as single-line labels.
                        const feed: Array<
                          | { kind: "text"; key: string; text: string }
                          | { kind: "tools"; key: string; events: AgentEvent[] }
                          | { kind: "event"; key: string; event: AgentEvent }
                        > = [];
                        for (const event of events.slice(-30)) {
                          if (
                            event.type === "run.started" ||
                            event.type === "run.completed"
                          ) {
                            continue;
                          }
                          if (event.type === "message.delta") {
                            if (!running) continue;
                            const last = feed.at(-1);
                            if (last?.kind === "text") {
                              last.text += event.delta;
                            } else {
                              feed.push({
                                kind: "text",
                                key: `${event.runId}-${event.sequence}`,
                                text: event.delta,
                              });
                            }
                            continue;
                          }
                          if (
                            event.type.startsWith("tool.") ||
                            event.type === "files.changed"
                          ) {
                            const last = feed.at(-1);
                            if (last?.kind === "tools") {
                              last.events.push(event);
                            } else {
                              feed.push({
                                kind: "tools",
                                key: `${event.runId}-${event.sequence}`,
                                events: [event],
                              });
                            }
                            continue;
                          }
                          feed.push({
                            kind: "event",
                            key: `${event.runId}-${event.sequence}`,
                            event,
                          });
                        }
                        return feed.map((item) => {
                          if (item.kind === "text") {
                            return (
                              <p
                                key={item.key}
                                className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85"
                              >
                                {item.text}
                              </p>
                            );
                          }
                          if (item.kind === "tools") {
                            return (
                              <ToolCallGroup
                                key={item.key}
                                events={item.events}
                              />
                            );
                          }
                          return (
                            <div
                              key={item.key}
                              className={cn(
                                "mt-1.5 text-xs leading-relaxed",
                                item.event.type.includes("failed")
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                              )}
                            >
                              {eventLabel(item.event)}
                            </div>
                          );
                        });
                      })()}
                      {activeRun?.status === "failed" && (
                        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
                          <p className="text-sm font-medium text-destructive">
                            {failureText(activeRun)}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 border-destructive/40 text-destructive hover:bg-destructive/10"
                            disabled={sending}
                            onClick={() => void retryLastPrompt()}
                          >
                            <RefreshCw className="size-3.5" />
                            重试这条消息
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="shrink-0">{composer}</div>
              </div>
            </Panel>
            <PanelResizeHandle
              className={cn(
                "panel-resize-handle",
                chatCollapsed ? "w-2" : "w-1",
              )}
            />
            <Panel
              ref={previewPanelRef}
              defaultSize={54}
              minSize={24}
              collapsible
              onCollapse={() => setPreviewCollapsed(true)}
              onExpand={() => setPreviewCollapsed(false)}
              className="min-w-0"
            >
              <div className="flex h-full min-w-0 flex-col">
                <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
                  <div className="flex min-w-0 flex-1 gap-1">
                    {(
                      [
                        ["preview", "预览", Eye],
                        ["files", "文件", FileCode2],
                        ["code", "代码", Code2],
                        ["publish", "发布", Globe],
                      ] as const
                    ).map(([tab, label, Icon]) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={rightTab === tab}
                        onClick={() => setRightTab(tab)}
                        className={cn(
                          "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium",
                          rightTab === tab
                            ? "bg-primary/10 text-primary dark:bg-stone-700/40 dark:text-stone-200"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                  {publication?.baseUrl && rightTab !== "publish" && (
                    <a
                      href={publication.baseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    >
                      已发布 ↗
                    </a>
                  )}
                  <div className="ml-1 shrink-0 border-l border-border pl-2">
                    <button
                      type="button"
                      aria-label={chatCollapsed ? "展开聊天" : "收起聊天"}
                      onClick={() => {
                        const panel = chatPanelRef.current;
                        if (!panel) return;
                        if (chatCollapsed) panel.expand();
                        else panel.collapse();
                      }}
                      className={cn(
                        "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                        chatCollapsed && "bg-primary/10 text-primary",
                      )}
                    >
                      {chatCollapsed ? (
                        <PanelLeftOpen className="size-5" />
                      ) : (
                        <PanelLeftClose className="size-5" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col">
                  {rightTab === "preview" &&
                    (preview?.url ? (
                      <iframe
                        title="项目 Preview"
                        key={`${selected.currentCommit}:${preview.updatedAt}`}
                        src={preview.url}
                        className="h-full w-full flex-1 bg-white"
                      />
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                        <strong className="text-sm">
                          {preview?.status === "failed"
                            ? "Preview 启动失败"
                            : preview?.status === "starting"
                              ? "正在启动 Preview…"
                              : "预览服务尚未连接"}
                        </strong>
                        <p className="mt-1.5 max-w-[320px] text-sm leading-relaxed text-muted-foreground">
                          {preview?.status === "starting"
                            ? "正在启动开发服务器，通常只需要几秒。"
                            : (preview?.errorMessage ??
                              "提交需求后，Agent 完成修改，这里会显示实际运行结果。")}
                        </p>
                      </div>
                    ))}
                  {rightTab === "files" && (
                    <div className="scrollbar-on-hover min-h-0 flex-1 overflow-y-auto p-2">
                      {files.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          disabled={file.kind === "directory"}
                          onClick={() =>
                            file.kind === "file"
                              ? void openFile(file.path)
                              : undefined
                          }
                          className={cn(
                            "flex w-full items-center gap-2 overflow-wrap-anywhere rounded-md px-2 py-1.5 text-left font-mono text-xs",
                            activeFile?.path === file.path
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                          )}
                        >
                          <span aria-hidden="true">
                            {file.kind === "directory" ? "▸" : "·"}
                          </span>
                          {file.path}
                        </button>
                      ))}
                    </div>
                  )}
                  {rightTab === "code" &&
                    (activeFile ? (
                      <pre className="scrollbar-on-hover m-0 min-h-0 flex-1 overflow-auto bg-(--background-darker) p-4 font-mono text-xs leading-relaxed">
                        <code>{activeFile.content}</code>
                      </pre>
                    ) : (
                      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        在“文件”标签选择一个文件查看内容
                      </div>
                    ))}
                  {rightTab === "publish" && (
                    <div className="scrollbar-on-hover min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                      <div className="flex items-center justify-between gap-3">
                        <strong className="text-sm font-semibold">
                          发布应用
                        </strong>
                        <Button
                          size="sm"
                          disabled={publishing || !!running}
                          onClick={() => void publishProject()}
                        >
                          <Globe className="size-4" />
                          {publishing ? "构建中…" : "发布当前版本"}
                        </Button>
                      </div>
                      {publication?.baseUrl ? (
                        <div className="flex items-start gap-4">
                          <a
                            href={publication.baseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 break-all text-sm text-primary hover:underline"
                          >
                            {publication.baseUrl}
                          </a>
                          <QrCard url={publication.baseUrl} />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          发布后会生成一个可公开访问的链接；再次发布或切换历史版本随时可回退。
                        </p>
                      )}
                      {releases.slice(0, 8).map((release) => (
                        <div
                          key={release.id}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border border-border px-3 py-2.5",
                            release.id === publication?.currentReleaseId &&
                              "border-primary",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold">
                              {release.createdAt.slice(0, 16).replace("T", " ")}
                              {release.id === publication?.currentReleaseId
                                ? " · 当前线上版本"
                                : ""}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {release.status} ·{" "}
                              {release.commitHash.slice(0, 7)}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              release.status !== "ready" ||
                              release.id === publication?.currentReleaseId
                            }
                            onClick={() => void activateRelease(release)}
                          >
                            {release.id === publication?.currentReleaseId
                              ? "线上"
                              : "切到此版本"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          </PanelGroup>
        )}
      </main>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from "react";
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

type LoadState = "idle" | "loading" | "ready";

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
  const [activeFile, setActiveFile] = useState<FileContent | null>(null);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<LoadState>("loading");
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected =
    projects.find((project) => project.id === selectedId) ?? null;

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
        setSelectedId(loaded[0]?.id ?? null);
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
  }, [selectedId]);

  useEffect(() => {
    if (!activeRun || terminalStatuses.has(activeRun.status)) return;
    const source = new EventSource(`/api/runs/${activeRun.id}/events/stream`);
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
          // The event URL points at the loopback listener; fetch the
          // browser-facing proxy URL derived by the API instead.
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
    source.onerror = () => setError("事件连接暂时中断，正在等待重连");
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

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const { project } = await requestJson<{ project: Project }>(
        "/api/projects",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      setProjects((current) => [project, ...current]);
      setSelectedId(project.id);
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目创建失败");
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
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件读取失败");
    }
  }

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !prompt.trim() || sending) return;
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
            prompt: prompt.trim(),
            idempotencyKey: crypto.randomUUID(),
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

  if (authUser === undefined) {
    return (
      <main className="app-shell">
        <div className="welcome-state">
          <p className="muted">正在检查登录状态…</p>
        </div>
      </main>
    );
  }

  if (!authUser) {
    return (
      <main className="app-shell">
        <div className="welcome-state">
          <p className="eyebrow">Atoms</p>
          <h1>{authMode === "register" ? "创建账号开始构建" : "欢迎回来"}</h1>
          <p>注册后即可创建项目，通过 Agent 生成应用并发布。</p>
          <form className="project-form" onSubmit={submitAuth}>
            {authMode === "register" && (
              <>
                <label htmlFor="auth-name">名称</label>
                <input
                  id="auth-name"
                  value={authName}
                  onChange={(event) => setAuthName(event.target.value)}
                  maxLength={80}
                  required
                />
              </>
            )}
            <label htmlFor="auth-email">邮箱</label>
            <input
              id="auth-email"
              type="email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              required
              autoComplete="email"
            />
            <label htmlFor="auth-password">密码</label>
            <input
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
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <div className="agent-actions">
              <button type="submit" disabled={authBusy}>
                {authBusy
                  ? "提交中…"
                  : authMode === "register"
                    ? "注册并开始"
                    : "登录"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode(
                    authMode === "register" ? "login" : "register",
                  );
                  setError(null);
                }}
              >
                {authMode === "register" ? "已有账号？登录" : "没有账号？注册"}
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  const running = activeRun && !terminalStatuses.has(activeRun.status);
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="Atoms 首页">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>Atoms</span>
        </a>
        <span className="environment">
          {authUser.email} ·{" "}
          <button type="button" onClick={() => void logout()}>
            退出
          </button>
        </span>
      </header>
      <div className="workbench" id="workspace">
        <aside className="sidebar" aria-label="项目导航">
          <div className="section-heading">
            <span>Projects</span>
            <span className="count">{projects.length}</span>
          </div>
          <form className="project-form" onSubmit={createProject}>
            <label htmlFor="project-name">新项目名称</label>
            <div className="field-row">
              <input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：产品反馈板"
                maxLength={80}
                disabled={creating}
              />
              <button type="submit" disabled={!name.trim() || creating}>
                {creating ? "创建中" : "创建"}
              </button>
            </div>
          </form>
          <nav className="project-list" aria-label="项目列表">
            {state === "loading" && <p className="muted">正在加载项目…</p>}
            {state === "ready" && projects.length === 0 && (
              <p className="empty-copy">
                创建项目后，Atoms 会生成一个可追踪版本的 React 工作区。
              </p>
            )}
            {projects.map((project) => (
              <button
                key={project.id}
                className={
                  project.id === selectedId
                    ? "project-item active"
                    : "project-item"
                }
                onClick={() => setSelectedId(project.id)}
                type="button"
              >
                <span>{project.name}</span>
                <small>{project.currentCommit.slice(0, 7)}</small>
              </button>
            ))}
          </nav>
        </aside>
        <section className="editor-panel" aria-label="项目工作区">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {!selected ? (
            <div className="welcome-state">
              <p className="eyebrow">AI application workspace</p>
              <h1>
                把想法变成<span className="accent-word">可运行的产品</span>
              </h1>
              <p>
                创建项目会初始化固定 React 模板和 Git
                历史。向 Agent 描述需求，观察真实的文件变更、版本与预览，然后一键发布。
              </p>
            </div>
          ) : (
            <>
              <header className="project-header">
                <div>
                  <p className="eyebrow">Project workspace</p>
                  <h1>{selected.name}</h1>
                </div>
                <span className="status">
                  <i aria-hidden="true" />
                  {running
                    ? `Agent ${activeRun?.status}`
                    : activeRun?.status === "failed"
                      ? "Needs attention"
                      : "Ready"}
                </span>
              </header>
              <div className="editor-grid">
                <aside className="file-browser" aria-label="项目文件">
                  <div className="panel-title">Files</div>
                  {files.map((file) => (
                    <button
                      className={
                        activeFile?.path === file.path ? "file active" : "file"
                      }
                      key={file.path}
                      onClick={() =>
                        file.kind === "file"
                          ? void openFile(file.path)
                          : undefined
                      }
                      disabled={file.kind === "directory"}
                      type="button"
                    >
                      <span aria-hidden="true">
                        {file.kind === "directory" ? "▸" : "·"}
                      </span>
                      {file.path}
                    </button>
                  ))}
                </aside>
                <section className="code-view" aria-label="文件内容">
                  <div className="panel-title">
                    {activeFile?.path ?? "Select a file"}
                  </div>
                  {activeFile ? (
                    <pre tabIndex={0}>
                      <code>{activeFile.content}</code>
                    </pre>
                  ) : (
                    <div className="code-empty">从左侧选择文件查看内容</div>
                  )}
                </section>
              </div>
              <section className="version-strip" aria-label="版本历史">
                <div>
                  <strong>Version history</strong>
                  <span>
                    {versions.length} 个可恢复版本 · current{" "}
                    {selected.currentCommit.slice(0, 12)}
                  </span>
                </div>
                <div className="version-list">
                  {versions.slice(0, 4).map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      disabled={version.commitHash === selected.currentCommit}
                      onClick={() => void restoreVersion(version)}
                      title={version.message}
                    >
                      {version.commitHash.slice(0, 7)}
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </section>
        <aside className="preview-panel" aria-label="预览与 Agent">
          <div className="panel-title">Preview</div>
          {preview?.url ? (
            <iframe
              className="preview-frame"
              title="项目 Preview"
              key={selected?.currentCommit ?? "none"}
              src={preview.url}
            />
          ) : (
            <div className="preview-empty">
              <span className="preview-icon" aria-hidden="true">
                ↗
              </span>
              <strong>
                {preview?.status === "failed"
                  ? "Preview 启动失败"
                  : "预览服务尚未连接"}
              </strong>
              <p>
                {preview?.errorMessage ??
                  "配置本地 Demo provider 或远程 Sandbox 后，这里会显示实际运行结果。"}
              </p>
            </div>
          )}
          <section className="activity" aria-label="发布">
            <div className="panel-title">发布</div>
            <div className="activity-list">
              <div className="message-item">
                <span>Public URL</span>
                {publication?.baseUrl ? (
                  <p>
                    <a href={publication.baseUrl} target="_blank" rel="noreferrer">
                      {publication.baseUrl}
                    </a>
                  </p>
                ) : (
                  <p>尚未发布。发布后应用可通过公网链接访问。</p>
                )}
              </div>
              <div className="agent-actions">
                <button
                  type="button"
                  disabled={!selected || publishing || !!running}
                  onClick={() => void publishProject()}
                >
                  {publishing ? "构建中…" : "发布当前版本"}
                </button>
              </div>
              {releases.length > 0 && (
                <div className="message-item">
                  <span>Releases</span>
                  {releases.slice(0, 4).map((release) => (
                    <button
                      key={release.id}
                      type="button"
                      disabled={
                        release.status !== "ready" ||
                        release.id === publication?.currentReleaseId
                      }
                      onClick={() => void activateRelease(release)}
                      title={release.errorMessage ?? release.commitHash}
                    >
                      {release.createdAt.slice(0, 19).replace("T", " ")} ·{" "}
                      {release.status}
                      {release.id === publication?.currentReleaseId
                        ? " · 当前"
                        : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
          <section className="activity" aria-label="Agent 活动">
            <div className="panel-title">Agent activity</div>
            <div className="activity-list">
              {events.length === 0 && messages.length === 0 && (
                <p className="muted">
                  提交需求后，这里会显示工具调用和版本事件。
                </p>
              )}
              {events.slice(-8).map((event) => (
                <div
                  className={`activity-item ${event.type.includes("failed") ? "failed" : ""}`}
                  key={`${event.runId}-${event.sequence}`}
                >
                  <span>{event.type}</span>
                  <p>{eventLabel(event)}</p>
                </div>
              ))}
              {messages.slice(-3).map((message) => (
                <div className="message-item" key={message.id}>
                  <span>{message.role === "user" ? "You" : "Agent"}</span>
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
          </section>
          <form className="agent-box" onSubmit={sendPrompt}>
            <label htmlFor="agent-prompt">告诉 Agent 你想构建什么</label>
            <textarea
              id="agent-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                selected
                  ? "例如：把启动页改成一个任务管理面板"
                  : "先创建一个项目"
              }
              disabled={!selected || !!sending}
            />
            <div className="agent-actions">
              <button
                type="submit"
                disabled={!selected || !prompt.trim() || !!sending}
              >
                {sending ? "执行中…" : "发送"}
              </button>
              {running && (
                <button type="button" onClick={() => void cancelRun()}>
                  取消
                </button>
              )}
            </div>
          </form>
        </aside>
      </div>
    </main>
  );
}

const stages = [
  ["01", "描述应用", "告诉 Agent 你想解决的问题。"],
  ["02", "生成与验证", "代码在隔离工作区中生成、构建和检查。"],
  ["03", "实时预览", "查看结果，继续对话修改，并随时恢复版本。"],
] as const;

export function App() {
  return (
    <main className="shell">
      <nav className="navigation" aria-label="主导航">
        <a className="brand" href="/" aria-label="Atoms 首页">
          <span className="brandMark" aria-hidden="true" />
          Atoms
        </a>
        <span className="status">Builder kernel · M0</span>
      </nav>

      <section className="hero">
        <p className="eyebrow">WEB AI APP BUILDER</p>
        <h1>把想法变成可以运行的产品。</h1>
        <p className="lead">
          Agent
          在隔离环境中理解需求、修改代码、执行验证，并把结果直接呈现在浏览器里。
        </p>
        <div className="prompt" aria-label="未来的应用描述输入区">
          <span>描述你想构建的应用…</span>
          <button type="button" disabled title="将在 Builder 里程碑开放">
            开始构建
          </button>
        </div>
        <p className="hint">
          当前正在建立安全的 Workspace、Sandbox 与 Agent 协议。
        </p>
      </section>

      <section className="stages" aria-label="产品流程">
        {stages.map(([number, title, detail]) => (
          <article className="stage" key={number}>
            <span>{number}</span>
            <h2>{title}</h2>
            <p>{detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

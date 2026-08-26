import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("waits for the session check before rendering workspace content", () => {
    const html = renderToString(<App />);
    expect(html).toContain("正在检查登录状态");
    expect(html).not.toContain("新项目名称");
    expect(html).not.toContain("预览服务尚未连接");
  });
});

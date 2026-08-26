import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders an honest project onboarding workflow", () => {
    const html = renderToString(<App />);
    expect(html).toContain("新项目名称");
    expect(html).toContain("从一个真实、可版本化的项目开始");
    expect(html).toContain("预览服务尚未连接");
  });
});

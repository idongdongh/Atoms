import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  it("renders the product promise and keeps the unfinished action disabled", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("把想法变成可以运行的产品");
    expect(markup).toContain("开始构建");
    expect(markup).toContain("disabled");
  });
});

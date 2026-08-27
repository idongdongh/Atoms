import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "./globals.css";

// Follow the system color scheme by toggling .dark on the root.
if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.classList.add("dark");
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

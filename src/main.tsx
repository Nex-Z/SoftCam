import { Capture } from "./Capture";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Float, Region } from "./Overlays";
import "./style.css";
const mode = location.hash;
document.body.className =
  mode === "#capture"
    ? "capture-mode"
    : mode === "#float"
      ? "float-mode"
      : mode === "#region"
        ? "region-mode"
        : "";
createRoot(document.getElementById("root")!).render(
  mode === "#capture" ? (
    <Capture />
  ) : mode === "#float" ? (
    <Float />
  ) : mode === "#region" ? (
    <Region />
  ) : (
    <App />
  ),
);

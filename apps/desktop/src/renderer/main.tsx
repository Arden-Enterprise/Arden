import React from "react";
import { createRoot } from "react-dom/client";
import { ArdenShell } from "@arden/ui";
import "@arden/ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ArdenShell platform="desktop" />
  </React.StrictMode>
);

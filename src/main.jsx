import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CronVisualizer from "../CronVisualizer.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <CronVisualizer />
  </StrictMode>
);

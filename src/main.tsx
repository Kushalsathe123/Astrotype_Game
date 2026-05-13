import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import GameCanvas from "./components/GameCanvas";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameCanvas />
  </StrictMode>
);
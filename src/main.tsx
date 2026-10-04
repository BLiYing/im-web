import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installGlobalLogging } from "./logging/logger";
import { installLanguageSync } from "./i18nDesktopSync";
import { installPowerSaving } from "./usePowerSaving";
import "./styles.css";

installGlobalLogging();
installLanguageSync();
installPowerSaving();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

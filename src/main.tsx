import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { PostHogProvider } from "@posthog/react";

const posthogOptions = {
  api_host: "https://eu.i.posthog.com",
  defaults: "2026-01-30",
} as const;

createRoot(document.getElementById("root")!).render(
  <PostHogProvider apiKey="phc_zqsqppb6V2aEsBkYWEdXh5LU9dXvUsAUBpHKcpEH3tC8" options={posthogOptions}>
    <App />
  </PostHogProvider>
);

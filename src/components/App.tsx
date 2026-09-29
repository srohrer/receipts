"use client";

import clsx from "clsx";
import { Moon, PanelLeft, Receipt, Settings, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useActiveDataset, useStore } from "@/lib/store";
import { AnalyzeView } from "./AnalyzeView";
import { DataGrid } from "./DataGrid";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { Spinner, Tabs } from "./ui";
import { toggleTheme, useIsDark } from "./useTheme";

const REPO_URL = "https://github.com/srohrer/receipts";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function DataView() {
  const ds = useActiveDataset();
  if (!ds) return null;
  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{ds.name}</h2>
        <span className="text-xs text-muted">
          {ds.rows.length.toLocaleString()} rows · virtualized · click a header to sort
        </span>
      </div>
      <DataGrid columns={ds.columns} rows={ds.rows} maxHeight="100%" className="min-h-0 flex-1" />
    </div>
  );
}

export function App() {
  const init = useStore((s) => s.init);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const error = useStore((s) => s.error);
  const dismissError = useStore((s) => s.dismissError);
  const apiKey = useStore((s) => s.apiKey);
  const server = useStore((s) => s.server);
  const dataset = useActiveDataset();
  const dark = useIsDark();
  const [settings, setSettings] = useState(false);
  const [sidebar, setSidebar] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  const mode = apiKey ? "Your key" : server?.sharedKey ? "Live" : server ? "Demo mode" : "…";

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel px-3 sm:px-4">
        <button className="text-muted hover:text-text lg:hidden" onClick={() => setSidebar((s) => !s)} aria-label="Toggle sidebar">
          <PanelLeft className="size-4" />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-brand text-white">
            <Receipt className="size-3.5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Receipts</span>
          <span className="hidden text-xs text-faint sm:inline">every claim, checked</span>
        </div>
        <Tabs
          className="ml-4 h-full border-b-0"
          value={view}
          onChange={setView}
          items={[
            { value: "analyze", label: "Analyze" },
            { value: "data", label: "Data" },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSettings(true)}
            className={clsx(
              "mr-1 hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:flex",
              mode === "Demo mode" ? "border-warn/40 text-warn" : "border-border text-muted",
            )}
          >
            <span className={clsx("size-1.5 rounded-full", mode === "Demo mode" ? "bg-warn" : "bg-ok")} />
            {mode}
          </button>
          <button onClick={toggleTheme} className="rounded-md p-2 text-muted hover:bg-panel-2 hover:text-text" aria-label="Toggle theme">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="rounded-md p-2 text-muted hover:bg-panel-2 hover:text-text" aria-label="Source on GitHub">
            <GitHubMark className="size-4" />
          </a>
          <button onClick={() => setSettings(true)} className="rounded-md p-2 text-muted hover:bg-panel-2 hover:text-text" aria-label="Settings">
            <Settings className="size-4" />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div
          className={clsx(
            "absolute inset-y-0 left-0 z-20 w-72 shrink-0 border-r border-border bg-panel transition-transform lg:static lg:translate-x-0",
            sidebar ? "translate-x-0 shadow-2xl" : "-translate-x-full",
          )}
        >
          <Sidebar onPick={() => setSidebar(false)} />
        </div>
        {sidebar && <div className="absolute inset-0 z-10 bg-black/30 lg:hidden" onClick={() => setSidebar(false)} />}
        <main className="min-w-0 flex-1">
          {!dataset ? (
            <div className="flex h-full items-center justify-center text-muted">
              <Spinner className="size-5" />
            </div>
          ) : view === "analyze" ? (
            <AnalyzeView />
          ) : (
            <DataView />
          )}
        </main>
      </div>

      {error && (
        <div className="fixed bottom-24 left-1/2 z-50 flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-start gap-3 rounded-xl border border-bad/30 bg-panel px-4 py-3 text-sm shadow-2xl">
          <span className="flex-1 text-text/90">{error}</span>
          <button onClick={dismissError} className="text-muted hover:text-text" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      )}

      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

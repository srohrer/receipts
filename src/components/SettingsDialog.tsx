"use client";

import { KeyRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "./ui";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const apiKey = useStore((s) => s.apiKey);
  const setApiKey = useStore((s) => s.setApiKey);
  const server = useStore((s) => s.server);
  const [draft, setDraft] = useState(apiKey);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setDraft(apiKey);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, apiKey]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl border border-border bg-panel p-0 text-text shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4 text-brand" /> Settings
          </h2>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-1.5 text-xs text-muted">
          <p>
            Model: <span className="font-mono text-text">{server?.model ?? "…"}</span> · shared demo key:{" "}
            <span className={server?.sharedKey ? "text-ok" : "text-warn"}>{server?.sharedKey ? "available" : "not configured"}</span>
          </p>
        </div>

        <label className="mt-4 block text-xs font-medium">Your DeepSeek API key (optional)</label>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="sk-…"
          className="mt-1.5 w-full rounded-lg border border-border bg-panel-2 px-3 py-2 font-mono text-xs outline-none focus:border-brand/60"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Stored only in this browser&apos;s localStorage. It is sent with each request to this app&apos;s API route, which
          forwards it to DeepSeek and never logs or stores it. With your own key there is no rate limit.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          {apiKey && (
            <Button
              variant="ghost"
              onClick={() => {
                setApiKey("");
                setDraft("");
              }}
            >
              Remove key
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              setApiKey(draft);
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </dialog>
  );
}

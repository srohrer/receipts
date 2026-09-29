"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { Claim } from "@/lib/dsl";
import type { Verdict } from "@/lib/verify";
import { STATUS_STYLE, StatusIcon } from "./ui";

export function ReceiptsPanel({
  claims,
  verdicts,
  previous,
  activeClaim,
  focusClaim,
  onHoverClaim,
}: {
  claims: Claim[];
  verdicts: Record<string, Verdict>;
  /** verdicts from the pre-repair draft, to show what changed */
  previous?: Record<string, Verdict>;
  activeClaim: string | null;
  focusClaim: string | null;
  onHoverClaim: (id: string | null) => void;
}) {
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    if (!focusClaim) return;
    const el = refs.current[focusClaim];
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el?.classList.remove("flash");
    void el?.offsetWidth;
    el?.classList.add("flash");
  }, [focusClaim]);

  return (
    <ol className="divide-y divide-border/70">
      {claims.map((c, i) => {
        const v = verdicts[c.id];
        const was = previous?.[c.id];
        const fixed = was && was.status !== "verified" && v?.status === "verified";
        const style = STATUS_STYLE[v?.status ?? "unverifiable"];
        return (
          <li
            key={c.id}
            ref={(el) => {
              refs.current[c.id] = el;
            }}
            onMouseEnter={() => onHoverClaim(c.id)}
            onMouseLeave={() => onHoverClaim(null)}
            className={clsx(
              "grid grid-cols-[auto_1fr_auto] items-start gap-3 px-3 py-2.5 text-xs transition-colors",
              activeClaim === c.id && "bg-panel-2",
            )}
          >
            <span className={clsx("mt-0.5 flex size-5 items-center justify-center rounded-full", style.bg)}>
              <StatusIcon status={v?.status ?? "unverifiable"} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-medium text-text">{c.statement}</span>
                {fixed && <span className="rounded bg-ok-soft px-1.5 py-px text-[10px] font-medium text-ok">fixed in repair</span>}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted">
                <span className="text-faint">{c.check.type}</span> · {v?.check}
              </div>
              {v?.note && <div className="mt-1 text-warn">{v.note}</div>}
              {fixed && was && (
                <div className="mt-1 text-faint">
                  draft: {was.expected ? `stated ${was.expected}, actual ${was.actual}` : was.note}
                </div>
              )}
            </div>
            {v?.expected !== undefined ? (
              <div className="text-right font-mono text-[11px] tabular-nums">
                <div className="text-muted">{v.expected}</div>
                <div className={style.text}>{v.actual}</div>
              </div>
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ol>
  );
}

"use client";

import clsx from "clsx";
import { Fragment, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Narrative as NarrativeT } from "@/lib/dsl";
import type { Verdict } from "@/lib/verify";
import { STATUS_STYLE, StatusIcon } from "./ui";

type Segment = string | { id: string; text: string };

export function parseBody(body: string): Segment[] {
  const out: Segment[] = [];
  const re = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push({ id: m[1].trim(), text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

const TIP_W = 288;

/** Verdict popover, portaled and clamped to the viewport so it never causes overflow. */
function VerdictTip({ verdict, anchor }: { verdict: Verdict; anchor: DOMRect }) {
  const style = STATUS_STYLE[verdict.status];
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - TIP_W - 8);
  const above = anchor.top > 180;
  return createPortal(
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left,
        width: TIP_W,
        ...(above ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
      }}
      className="pointer-events-none z-50 rounded-lg border border-border bg-panel p-3 text-xs leading-relaxed text-text shadow-xl"
    >
      <span className={clsx("mb-1 flex items-center gap-1.5 font-semibold", style.text)}>
        <StatusIcon status={verdict.status} />
        {style.label}
      </span>
      <span className="block text-muted">{verdict.check}</span>
      {verdict.expected !== undefined && (
        <span className="mt-2 grid grid-cols-2 gap-2 font-mono">
          <span>
            <span className="block text-[10px] text-faint uppercase">stated</span>
            {verdict.expected}
          </span>
          <span>
            <span className="block text-[10px] text-faint uppercase">actual</span>
            <span className={style.text}>{verdict.actual}</span>
          </span>
        </span>
      )}
      {verdict.note && <span className="mt-1 block text-warn">{verdict.note}</span>}
    </div>,
    document.body,
  );
}

function ClaimMark({
  text,
  verdict,
  active,
  strike,
  onHover,
  onSelect,
}: {
  text: string;
  verdict?: Verdict;
  active: boolean;
  strike?: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
}) {
  const status = verdict?.status ?? "unverifiable";
  const style = STATUS_STYLE[status];
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = (on: boolean) => {
    setAnchor(on && ref.current ? ref.current.getBoundingClientRect() : null);
    onHover(on);
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={() => show(true)}
        onMouseLeave={() => show(false)}
        onFocus={() => show(true)}
        onBlur={() => show(false)}
        onClick={onSelect}
        className={clsx(
          "rounded-sm px-0.5 text-left underline decoration-2 underline-offset-[5px] transition-colors",
          status === "verified" && "decoration-ok/50",
          status === "contradicted" && "decoration-bad/70",
          status === "unverifiable" && "decoration-warn/60 decoration-dashed",
          active && style.bg,
          strike && status === "contradicted" && "line-through decoration-bad",
        )}
      >
        {text}
        <sup className="ml-0.5 inline-flex translate-y-[-1px]">
          <StatusIcon status={status} className="size-2.5" />
        </sup>
      </button>
      {verdict && anchor && <VerdictTip verdict={verdict} anchor={anchor} />}
    </>
  );
}

export function NarrativeView({
  narrative,
  verdicts,
  activeClaim,
  onHoverClaim,
  onSelectClaim,
  draft,
}: {
  narrative: NarrativeT;
  verdicts: Record<string, Verdict>;
  activeClaim: string | null;
  onHoverClaim: (id: string | null) => void;
  onSelectClaim: (id: string) => void;
  draft?: boolean;
}) {
  const segments = useMemo(() => parseBody(narrative.body), [narrative.body]);
  return (
    <div>
      <h3 className="text-lg leading-snug font-semibold text-balance">{narrative.headline}</h3>
      <p className="mt-2 text-[15px] leading-8 text-text/90">
        {segments.map((s, i) =>
          typeof s === "string" ? (
            <Fragment key={i}>{s}</Fragment>
          ) : (
            <ClaimMark
              key={i}
              text={s.text}
              verdict={verdicts[s.id]}
              active={activeClaim === s.id}
              strike={draft}
              onHover={(on) => onHoverClaim(on ? s.id : null)}
              onSelect={() => onSelectClaim(s.id)}
            />
          ),
        )}
      </p>
      {narrative.caveats?.length ? (
        <ul className="mt-3 space-y-1 border-l-2 border-border pl-3 text-xs text-muted">
          {narrative.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

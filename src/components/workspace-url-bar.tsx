"use client";

import { useEffect, useState } from "react";

/**
 * The URL is the only key to this workspace, so the app says so plainly and
 * makes it one click to keep. A user who loses this link has lost the
 * workspace — that is the honest cost of having no login, and hiding it would
 * be the actual design failure.
 */
export function WorkspaceUrlBar({ workspaceId }: { workspaceId: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // Clipboard can be blocked. The URL is visible either way, so there is
      // nothing to recover from and nothing worth interrupting the user over.
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-stone-500">
        Workspace
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-stone-700">
        {workspaceId}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 active:bg-stone-100"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

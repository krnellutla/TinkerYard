"use client";

import { useEffect, useRef, useState } from "react";
import { acceptUpload, MAX_UPLOAD } from "@tallyback/lib/upload";
import type { Extraction } from "@tallyback/lib/types";
import { shrink } from "@tallyback/ui/upload";
import { iconButton } from "./kit";

// Receipts on expenses: take a photo (or pick a file), have it read, and keep it on the expense where
// everyone in the group can open it. Reading reuses TallyBack's bill reader (/api/tallyback/scan);
// with keep=1 a photo that can't be read is still kept, so the person just types the amount.

export const receiptUrl = (groupId: string, expenseId: string) => `/api/tallyback/groups/${groupId}/expenses/${expenseId}/receipt`;

export type ScanOutcome =
  | { kind: "read"; billId: string; extraction: Extraction }
  | { kind: "kept"; billId: string; error: string } // couldn't be read, but the photo is on the expense
  | { kind: "failed"; error: string };

export async function scanReceipt(file: File): Promise<ScanOutcome> {
  const blob = await shrink(file);
  const type = blob.type || file.type || "image/jpeg";
  const check = acceptUpload(type, blob.size);
  if (!check.ok) return { kind: "failed", error: blob.size > MAX_UPLOAD ? check.error : check.error };
  const fd = new FormData();
  fd.append("keep", "1");
  fd.append("file", blob, type === "application/pdf" ? file.name : blob === file ? file.name : "receipt.jpg");
  try {
    const r = await fetch("/api/tallyback/scan", { method: "POST", body: fd });
    const text = await r.text();
    let j: { billId?: string; extraction?: Extraction; error?: string; kept?: boolean } = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      return { kind: "failed", error: r.status === 504 ? "Reading the receipt took too long. Try again, or enter it yourself." : `Something went wrong (${r.status}).` };
    }
    if (r.ok && j.billId && j.extraction) return { kind: "read", billId: j.billId, extraction: j.extraction };
    if (j.kept && j.billId) return { kind: "kept", billId: j.billId, error: j.error ?? "Couldn't read it. The photo is saved." };
    return { kind: "failed", error: j.error ?? "Couldn't read the receipt." };
  } catch {
    return { kind: "failed", error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export type ReceiptState =
  | { kind: "none" }
  | { kind: "scanning"; preview: string | null }
  | { kind: "read"; preview: string | null; items: number }
  | { kind: "kept"; preview: string | null; note: string }
  | { kind: "failed"; preview: string | null; note: string }
  | { kind: "attached"; preview: string }; // already on the expense (editing)

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

// The hidden inputs behind every "take a photo / upload" button. capture="environment" opens the rear
// camera straight away on phones; the upload input has no capture, so the file picker (and PDFs) work.
export function useReceiptPickers(onFile: (f: File) => void) {
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // the same photo can be picked again
    if (f) onFile(f);
  };
  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={upload} type="file" accept="image/*,application/pdf" hidden onChange={pick} />
    </>
  );
  return { inputs, takePhoto: () => camera.current?.click(), chooseFile: () => upload.current?.click() };
}

function Thumb({ src, onView, scanning }: { src: string | null; onView?: () => void; scanning?: boolean }) {
  const [broken, setBroken] = useState(false);
  const box = "relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-line bg-paper";
  const inner =
    src && !broken ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="Receipt" onError={() => setBroken(true)} className="h-full w-full object-cover" />
    ) : (
      <span className="flex h-full w-full items-center justify-center text-xl" aria-hidden="true">
        🧾
      </span>
    );
  return onView ? (
    <button type="button" onClick={onView} aria-label="View receipt" className={box}>
      {inner}
    </button>
  ) : (
    <span className={box}>
      {inner}
      {scanning && <span aria-hidden="true" className="animate-receipt-scan absolute inset-x-0 top-0 h-0.5 bg-good shadow-[0_0_8px_2px_rgba(21,128,61,.5)]" />}
    </span>
  );
}

// The receipt tile at the top of the expense form, in each of its states.
export function ReceiptTile({
  state,
  onTakePhoto,
  onChooseFile,
  onView,
  onRemove,
}: {
  state: ReceiptState;
  onTakePhoto: () => void;
  onChooseFile: () => void;
  onView?: () => void;
  onRemove: () => void;
}) {
  // "This can take 30 s" once it's clearly not instant.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state.kind !== "scanning") return setSlow(false);
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, [state.kind]);

  if (state.kind === "none")
    return (
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={onTakePhoto}
          className="flex min-h-16 flex-1 items-center gap-3 rounded-2xl border border-dashed border-ink/30 bg-card px-4 text-left active:bg-line/40"
        >
          <CameraIcon />
          <span>
            <span className="block font-semibold">Scan receipt</span>
            <span className="block text-xs text-muted">Fills in the amount and items for you</span>
          </span>
        </button>
        <button type="button" onClick={onChooseFile} className="min-h-16 rounded-2xl border border-line bg-card px-4 text-sm font-medium active:bg-line/40">
          Upload
        </button>
      </div>
    );

  const tone =
    state.kind === "scanning"
      ? "border-line bg-card"
      : state.kind === "read"
        ? "border-good/30 bg-good-soft"
        : state.kind === "kept"
          ? "border-warn/30 bg-warn-soft"
          : state.kind === "failed"
            ? "border-bad/30 bg-bad-soft"
            : "border-line bg-card";
  const text =
    state.kind === "scanning"
      ? { title: "Reading the receipt…", sub: slow ? "Still working; this can take up to 30 seconds." : "You can keep filling in the form." }
      : state.kind === "read"
        ? { title: "Filled in from the receipt", sub: `${state.items} item${state.items === 1 ? "" : "s"} · check the amount, then save` }
        : state.kind === "kept"
          ? { title: "Photo attached", sub: state.note }
          : state.kind === "failed"
            ? { title: "Couldn't use that photo", sub: state.note }
            : { title: "Receipt attached", sub: "Everyone in the group can open it." };

  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-2.5 ${tone}`} aria-live="polite">
      <Thumb src={state.preview} scanning={state.kind === "scanning"} onView={state.kind !== "scanning" && state.kind !== "failed" ? onView : undefined} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{text.title}</span>
        <span className="block text-xs text-muted">{text.sub}</span>
      </span>
      {state.kind !== "scanning" && (
        <span className="flex shrink-0 flex-col items-end">
          <button type="button" onClick={onTakePhoto} className="min-h-9 px-2 text-xs font-medium underline underline-offset-4">
            {state.kind === "failed" ? "Retry" : "Replace"}
          </button>
          <button type="button" onClick={onRemove} className="min-h-9 px-2 text-xs text-muted underline underline-offset-4">
            Remove
          </button>
        </span>
      )}
    </div>
  );
}

// Full-screen receipt, pinch to zoom (the browser's own). PDFs and anything that won't show as an
// image get an "Open" link instead.
export function ReceiptViewer({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={`Receipt: ${title}`} className="fixed inset-0 z-[60] flex h-dvh flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-2 px-2 pt-[env(safe-area-inset-top)]">
        <span className="min-w-0 truncate pl-3 text-sm font-medium">{title}</span>
        <span className="flex items-center">
          <a href={src} target="_blank" rel="noopener" className="min-h-11 px-3 py-3 text-sm underline underline-offset-4">
            Open
          </a>
          <button onClick={onClose} aria-label="Close receipt" className={`${iconButton} text-2xl`}>
            ×
          </button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 pb-[max(.5rem,env(safe-area-inset-bottom))]" style={{ touchAction: "pinch-zoom" }}>
        {broken ? (
          <a href={src} target="_blank" rel="noopener" className="rounded-2xl bg-white/10 px-5 py-4 text-center">
            This receipt is a PDF or can&apos;t be shown here.
            <span className="mt-1 block font-semibold underline underline-offset-4">Open it</span>
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Receipt for ${title}`} onError={() => setBroken(true)} className="max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>
  );
}

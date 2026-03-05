import { useState } from "react";

interface CommentComposerProps {
  disabled?: boolean;
  onSubmit: (bodyText: string) => void;
}

export function CommentComposer({ disabled = false, onSubmit }: CommentComposerProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={600}
        rows={3}
        placeholder="Add a comment..."
        className="w-full rounded-xl border border-tide/25 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-0 transition placeholder:text-slate-400 focus:border-ember sm:text-sm"
        disabled={disabled}
      />
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{600 - value.length} characters left</span>
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="rounded-full bg-ember px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition hover:brightness-110 disabled:opacity-60"
        >
          Post comment
        </button>
      </div>
    </form>
  );
}


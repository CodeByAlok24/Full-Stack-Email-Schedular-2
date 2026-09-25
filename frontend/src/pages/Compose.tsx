import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { parseEmails } from "../lib/csv";
import { sanitizeEmailHtml, api } from "../lib/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatSize(bytes: number): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Compose() {
  const nav = useNavigate();
  const [sender, setSender] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [invalidCount, setInvalidCount] = useState(0);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [delay, setDelay] = useState(2);
  const [hourly, setHourly] = useState(50);
  const [showSendLater, setShowSendLater] = useState(false);
  const [isScheduledLater, setIsScheduledLater] = useState(false);
  const [draftStart, setDraftStart] = useState(() => localInputValue(new Date(Date.now() + 5 * 60 * 1000)));
  const [startAt, setStartAt] = useState(draftStart);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<
    { name: string; size: number; type: string; content?: string }[]
  >([]);
  const popRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.me().then((r) => {
      if (r.user?.email && !sender) {
        setSender(r.user.email);
      }
    }).catch(() => {});
  }, [sender]);

  useEffect(() => {
    if (!showSendLater) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setShowSendLater(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showSendLater]);

  function commitDraft(extra?: string) {
    const text = [draft, extra].filter(Boolean).join("\n");
    if (!text.trim()) return;
    const { valid, invalid } = parseEmails(text);
    setChips((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const v of valid) if (!seen.has(v)) { seen.add(v); next.push(v); }
      return next;
    });
    setInvalidCount(invalid.length);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && !draft && chips.length) {
      setChips((c) => c.slice(0, -1));
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const lower = f.name.toLowerCase();
    const isTextList = /\.(csv|txt)$/.test(lower) || f.type.startsWith("text/");
    if (!isTextList) {
      setMsg(`"${f.name}" isn't a recipient list — Upload List reads .csv/.txt only. Use the paperclip icon to attach PDF/DOC files.`);
      return;
    }
    f.text().then(
      (t) => {
        const { valid, invalid } = parseEmails(t);
        if (valid.length === 0) {
          setInvalidCount(invalid.length);
          setMsg(`No valid emails found in "${f.name}"${invalid.length ? ` (${invalid.length} invalid)` : ""}.`);
          return;
        }
        setChips((prev) => {
          const seen = new Set(prev);
          const next = [...prev];
          for (const v of valid) if (!seen.has(v)) { seen.add(v); next.push(v); }
          return next;
        });
        setInvalidCount(invalid.length);
        setMsg(`Added ${valid.length} email${valid.length === 1 ? "" : "s"} from "${f.name}"${invalid.length ? `, ${invalid.length} invalid skipped` : ""}.`);
      },
      () => setMsg(`Couldn't read "${f.name}". Try a .csv or .txt file.`),
    );
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function onAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!files.length) return;
    setMsg("Reading files…");
    try {
      const loaded = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
          content: await fileToBase64(f),
        })),
      );
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => `${a.name}:${a.size}`));
        const next = [...prev];
        for (const f of loaded) {
          const key = `${f.name}:${f.size}`;
          if (!seen.has(key)) {
            seen.add(key);
            next.push(f);
          }
        }
        return next;
      });
      setMsg(
        loaded.length === 1
          ? `Attached "${loaded[0].name}" (${formatSize(loaded[0].size)})`
          : `Attached ${loaded.length} files`,
      );
    } catch {
      setMsg("Couldn't read one of the files — try again.");
    }
  }

  function removeAttachment(name: string, size: number) {
    setAttachments((prev) => prev.filter((a) => !(a.name === name && a.size === size)));
  }

  const canSend = Boolean(subject.trim()) && chips.length > 0 && EMAIL_RE.test(sender) && !saving;

  async function onSchedule() {
    if (!canSend) return;
    setSaving(true);
    setMsg(null);
    const html = sanitizeEmailHtml(editorRef.current?.innerHTML ?? "");
    const pickedTime = new Date(startAt).getTime();
    const isFuture = Number.isFinite(pickedTime) && pickedTime > Date.now() + 1000;
    const targetStartAt = isScheduledLater && isFuture ? new Date(startAt).toISOString() : new Date().toISOString();
    const payload = {
      subject: subject.trim(),
      body: html || bodyHtml || body,
      recipients: chips,
      sender,
      startAt: targetStartAt,
      delayBetweenEmails: delay,
      hourlyLimit: hourly,
      attachments: attachments.map(({ name, size, type, content }) => ({
        name,
        size,
        type,
        ...(content ? { content } : {}),
      })),
    };
    try {
      await api.schedule(payload);
      if (isScheduledLater && isFuture) {
        const timeStr = new Date(startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setMsg(`✓ Scheduled ${chips.length} email${chips.length === 1 ? "" : "s"} for ${timeStr} — check Scheduled tab!`);
        setTimeout(() => nav("/"), 1200);
      } else {
        setMsg(`✓ Sent ${chips.length} email${chips.length === 1 ? "" : "s"} via Ethereal SMTP — check Sent tab!`);
        setTimeout(() => nav("/sent"), 1200);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to schedule emails";
      try {
        const parsed = JSON.parse(message);
        setMsg(`Error: ${parsed.message ?? message}`);
      } catch {
        const match = message.match(/"message"\s*:\s*"([^"]+)"/);
        setMsg(`Error: ${match ? match[1] : message}`);
      }
    } finally {
      setSaving(false);
    }
  }

  function exec(cmd: string, val?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    setBody(editorRef.current?.innerText ?? "");
    setBodyHtml(editorRef.current?.innerHTML ?? "");
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <Link to="/" className="text-sm font-medium hover:text-emerald-700">← Compose New Email</Link>
        <div className="relative flex items-center gap-3" ref={popRef}>
          <label className="cursor-pointer text-emerald-600 hover:text-emerald-700" title="Attach file">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <input
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp"
              onChange={(e) => { void onAttach(e); }}
            />
          </label>
          <button type="button" className="text-emerald-600 hover:text-emerald-700" title="Schedule">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <Button
            variant={isScheduledLater ? "primary" : "outline"}
            className="text-xs"
            onClick={() => {
              setDraftStart(startAt);
              setShowSendLater((v) => !v);
            }}
          >
            {isScheduledLater ? "Scheduled Later" : "Send Later"}
          </Button>
          {showSendLater && (
            <div className="absolute right-0 top-11 z-20 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
              <div className="text-sm font-medium">Schedule Send Time</div>
              <div className="text-xs text-slate-500">Pick date & time in your local timezone</div>
              <input
                type="datetime-local"
                value={draftStart}
                onChange={(e) => {
                  const val = e.target.value;
                  setDraftStart(val);
                  setStartAt(val);
                  setIsScheduledLater(true);
                }}
                className="mt-3 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-400 outline-none"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  className="text-xs text-slate-500"
                  onClick={() => {
                    setIsScheduledLater(false);
                    setShowSendLater(false);
                  }}
                >
                  Send Immediately
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" className="text-xs" onClick={() => setShowSendLater(false)}>Close</Button>
                  <Button
                    variant="outline"
                    className="text-xs"
                    onClick={() => {
                      setStartAt(draftStart);
                      setIsScheduledLater(true);
                      setShowSendLater(false);
                    }}
                  >
                    Done
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-4xl p-6 text-sm">
        <div className="space-y-4">
          <div className="flex gap-4">
            <span className="w-28 shrink-0 pt-2 text-slate-500">From</span>
            <div className="flex-1">
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value.trimStart())}
                placeholder="you@domain.com"
                inputMode="email"
                className="w-full max-w-md rounded-md border border-slate-200 bg-slate-50 px-3 py-2 outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white"
              />
              {sender && !EMAIL_RE.test(sender) && (
                <div className="mt-1 text-xs text-red-500">Enter a valid email address.</div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-4">
            <span className="w-28 shrink-0 pt-2 text-slate-500">To</span>
            <div className="min-w-0 flex-1">
              <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 focus-within:border-emerald-400">
                {chips.slice(0, 4).map((e) => (
                  <span key={e} className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-800">
                    {e}
                    <button type="button" aria-label={`Remove ${e}`} className="hover:text-red-500" onClick={() => setChips((c) => c.filter((x) => x !== e))}>×</button>
                  </span>
                ))}
                {chips.length > 4 && <span className="rounded-full border border-emerald-300 px-2 py-0.5 text-xs">+{chips.length - 4}</span>}
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  onBlur={() => commitDraft()}
                  placeholder={chips.length ? "" : "recipient@example.com"}
                  className="min-w-40 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-slate-400"
                />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {chips.length > 0 && <>Detected {chips.length} valid{invalidCount > 0 && `, ${invalidCount} invalid`}.</>}
                {EMAIL_RE.test(draft) === false && draft && draft.includes("@") && <> Type Enter to add.</>}
              </div>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs font-medium text-emerald-700 hover:underline">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload List
              <input type="file" accept=".csv,.txt" className="hidden" onChange={onFile} />
            </label>
          </div>

          <div className="flex gap-4">
            <span className="w-28 shrink-0 pt-2 text-slate-500">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 border-b border-slate-200 pb-1 outline-none placeholder:text-slate-400 focus:border-emerald-400"
            />
          </div>

          {attachments.length > 0 && (
            <div className="flex gap-4">
              <span className="w-28 shrink-0 pt-2 text-slate-500">Attached</span>
              <ul className="flex flex-1 flex-wrap gap-2">
                {attachments.map((a) => (
                  <li
                    key={`${a.name}:${a.size}`}
                    className="inline-flex max-w-64 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="min-w-0">
                      <span className="block max-w-40 truncate font-medium text-slate-700" title={a.name}>{a.name}</span>
                      <span className="text-slate-400">{formatSize(a.size)}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${a.name}`}
                      className="shrink-0 text-slate-400 hover:text-red-500"
                      onClick={() => removeAttachment(a.name, a.size)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-slate-500">Delay between emails (seconds)</span>
            <input
              type="number"
              min={0}
              value={delay}
              onChange={(e) => setDelay(Math.max(0, Number(e.target.value)))}
              className="w-16 rounded-md border border-slate-200 px-2 py-1.5 text-center outline-none focus:border-emerald-400"
            />
            <span className="text-slate-500">Hourly Limit</span>
            <input
              type="number"
              min={0}
              value={hourly}
              onChange={(e) => setHourly(Math.max(0, Number(e.target.value)))}
              className="w-16 rounded-md border border-slate-200 px-2 py-1.5 text-center outline-none focus:border-emerald-400"
            />
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <span>Start:</span>
              <span className={isScheduledLater ? "font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200" : "font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded"}>
                {isScheduledLater
                  ? new Date(startAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                  : "Immediately (Now)"}
              </span>
              {isScheduledLater && (
                <button
                  type="button"
                  onClick={() => setIsScheduledLater(false)}
                  className="text-[11px] text-slate-400 hover:text-red-500 underline ml-1"
                >
                  (Reset to Now)
                </button>
              )}
            </span>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-white px-2 py-1.5 text-sm text-slate-600 shadow-sm">
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("undo")} title="Undo">↶</button>
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("redo")} title="Redo">↷</button>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <select
                aria-label="Font size"
                className="mr-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-600 hover:border-slate-200 outline-none"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "1") exec("fontSize", "1");
                  else if (v === "3") exec("fontSize", "3");
                  else if (v === "5") exec("fontSize", "5");
                }}
                defaultValue="3"
              >
                <option value="1">Tt: Small</option>
                <option value="3">Tt: Normal</option>
                <option value="5">Tt: Large</option>
              </select>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <button type="button" className="px-2 py-1 font-bold hover:bg-slate-100 rounded" onClick={() => exec("bold")} title="Bold">B</button>
              <button type="button" className="px-2 py-1 italic hover:bg-slate-100 rounded" onClick={() => exec("italic")} title="Italic">I</button>
              <button type="button" className="px-2 py-1 underline hover:bg-slate-100 rounded" onClick={() => exec("underline")} title="Underline">U</button>
              <button type="button" className="px-2 py-1 line-through hover:bg-slate-100 rounded" onClick={() => exec("strikeThrough")} title="Strikethrough">S</button>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("justifyLeft")} title="Align left">≡</button>
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("justifyCenter")} title="Align center">≣</button>
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("justifyRight")} title="Align right">≡</button>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("insertUnorderedList")} title="Bulleted list">• ≡</button>
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("insertOrderedList")} title="Numbered list">1. ≡</button>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("indent")} title="Indent">»</button>
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("outdent")} title="Outdent">«</button>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("formatBlock", "blockquote")} title="Quote">“ ”</button>
              <button
                type="button"
                className="px-2 py-1 hover:bg-slate-100 rounded"
                title="Insert link"
                onClick={() => {
                  const url = window.prompt("Enter URL");
                  if (url) exec("createLink", url);
                }}
              >
                🔗
              </button>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <button type="button" className="px-2 py-1 hover:bg-slate-100 rounded" onClick={() => exec("removeFormat")} title="Clear formatting">Tx</button>
            </div>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => {
                setBody((editorRef.current?.innerText ?? "").trimEnd());
                setBodyHtml(editorRef.current?.innerHTML ?? "");
              }}
              data-ph="Type Your Reply..."
              className="mt-3 min-h-44 w-full rounded-md bg-white p-4 text-sm outline-none empty:before:text-slate-400 empty:before:content-[attr(data-ph)]"
            />
          </div>

          <div className="flex items-center gap-3 pb-8">
            <Button disabled={!canSend} onClick={onSchedule}>
              {saving ? "Scheduling…" : isScheduledLater ? "Schedule for Later" : "Send / Schedule"}
            </Button>
            {msg && (
              <span
                className={`text-sm px-3 py-1 rounded-md font-medium ${
                  msg.startsWith("Error")
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                }`}
              >
                {msg}
              </span>
            )}
            {(!subject.trim() || chips.length === 0 || !EMAIL_RE.test(sender)) && !msg && (
              <span className="text-xs text-slate-400">Add your From email + subject + at least one recipient</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

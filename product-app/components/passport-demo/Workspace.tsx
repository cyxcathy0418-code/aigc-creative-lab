"use client";
/* eslint-disable @next/next/no-img-element -- Shared with the standalone Worker; uploads are resized on-device and never use a Next.js image proxy. */
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  createSampleDraft,
  switchDraftMarket,
  makeSrt,
  validateForRender,
  type Draft,
  type Direction,
  type Workspace,
  type Snapshot,
} from "../../lib/passport-demo/workflow";
import {
  imageUrl,
  loadImage,
  drawFrame,
  compressImage,
  renderVideo,
  downloadBlob,
  downloadPackage,
} from "../../lib/passport-demo/media";
import {
  cacheVideo,
  cachedVideo,
  recoverWorkspace,
} from "../../lib/passport-demo/artifact-cache";

const steps = [
  "Product & facts",
  "Creative direction",
  "Storyboard",
  "Preview & export",
];
function Icon({ name = "spark", size = 20 }: { name?: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    spark: (
      <>
        <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    film: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l4 4v14H3V3h2Z" />
        <path d="M7 3v6h10V3M7 21v-8h10v8" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V6a4 4 0 0 1 8 0v4" />
      </>
    ),
    play: <path d="m9 5 11 7-11 7V5Z" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.spark}
    </svg>
  );
}
function Field({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <label className="cp-field">
      <span>{label}</span>
      {children}
      {note && <small>{note}</small>}
    </label>
  );
}
function PhonePreview({
  draft,
  videoUrl,
}: {
  draft: Draft;
  videoUrl: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    if (draft.shots.length && canvas.current) {
      void loadImage(imageUrl(draft))
        .then((img) => {
          if (active && canvas.current) {
            const ctx = canvas.current.getContext("2d");
            if (ctx) {
              try {
                drawFrame(ctx, draft, img, 0);
              } catch {
                ctx.fillStyle = "#173c2c";
                ctx.fillRect(0, 0, 360, 640);
              }
            }
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [draft]);
  return (
    <div className="cp-phone">
      {videoUrl ? (
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          playsInline
          aria-label="Rendered 15-second preview"
        />
      ) : draft.shots.length ? (
        <canvas
          ref={canvas}
          width="360"
          height="640"
          aria-label="First frame of the current storyboard"
        />
      ) : (
        <div className="cp-phone-empty">
          <img
            src={imageUrl(draft)}
            alt={
              draft.isSample
                ? "Vector illustration of the fictional ROAM grinder"
                : "Your product reference"
            }
          />
          <div>
            <small>YOUR PRODUCT. A NEW PERSPECTIVE.</small>
            <strong>{draft.productName}</strong>
            <span>
              Make a little space
              <br />
              for possibility.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/demo/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Could not complete the request.");
  return result as T;
}
export default function WorkspaceApp() {
  const [draft, setDraft] = useState<Draft>(() => createSampleDraft());
  const [workspace, setWorkspace] = useState<Workspace>({
    revision: 0,
    draft: null,
    versions: [],
  });
  const [step, setStep] = useState(0);
  const [view, setView] = useState<"create" | "versions" | "about">("create");
  const [directions, setDirections] = useState<Direction[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState<Blob | null>(null);
  const [videoHash, setVideoHash] = useState<string | null>(null);
  const [pendingReset, setPendingReset] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<string | null>(null);
  const [audio, setAudio] = useState<AudioBuffer>();
  const [audioName, setAudioName] = useState("");
  const controller = useRef<AbortController | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  function requestConfirmation(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirmResolver.current = resolve;
      setConfirmMessage(message);
    });
  }
  function finishConfirmation(value: boolean) {
    setConfirmMessage(null);
    confirmResolver.current?.(value);
    confirmResolver.current = null;
  }

  const latest = workspace.versions.at(-1);
  const confirmedCount = draft.facts.filter((f) => f.confirmed).length;
  function replaceVideo(blob: Blob | null, hash: string | null = null) {
    setVideoHash(hash);
    if (videoRef.current) URL.revokeObjectURL(videoRef.current);
    videoRef.current = blob ? URL.createObjectURL(blob) : null;
    setVideoUrl(videoRef.current);
    setVideo(blob);
  }
  useEffect(() => {
    let active = true;
    void recoverWorkspace(() => api<Workspace>("workspace"), cachedVideo)
      .then(({ workspace: data, video, videoHash }) => {
        if (!active) return;
        setWorkspace(data);
        if (data.draft) {
          setDraft(data.draft);
          setStep(video ? 3 : data.draft.shots.length ? 2 : 0);
        }
        if (video) replaceVideo(video, videoHash);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
      controller.current?.abort();
      if (videoRef.current) URL.revokeObjectURL(videoRef.current);
    };
  }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirty || rendering) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, rendering]);
  function change(patch: Partial<Draft>) {
    setDraft((previous) => ({ ...previous, ...patch, scriptConfirmed: false }));
    setDirty(true);
    setMessage("");
    replaceVideo(null);
  }
  function editFact(index: number, patch: Partial<Draft["facts"][number]>) {
    change({
      facts: draft.facts.map((fact, i) =>
        i === index
          ? { ...fact, ...patch, confirmed: patch.confirmed ?? false }
          : fact,
      ),
    });
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function save(
    intent: "save" | "confirm" | "restore" = "save",
    nextDraft = draft,
    restoreVersionId?: string,
  ) {
    const data = await api<Workspace>("workspace", "PUT", {
      expectedRevision: workspace.revision,
      draft: nextDraft,
      intent: intent === "save" && pendingReset ? "reset" : intent,
      ...(restoreVersionId ? { restoreVersionId } : {}),
    });
    setPendingReset(false);
    setWorkspace(data);
    setDraft(data.draft!);
    setDirty(false);
    setMessage(
      intent === "confirm"
        ? "Script confirmed. Ready to render."
        : "Project saved to your private workspace.",
    );
    return data;
  }
  async function explore() {
    await action(async () => {
      await save();
      const data = await api<{ directions: Direction[] }>(
        "directions",
        "POST",
        draft,
      );
      setDirections(data.directions);
      setStep(1);
    });
  }
  async function selectDirection(direction: Direction["id"]) {
    await action(async () => {
      const data = await api<{ draft: Draft }>("storyboard", "POST", {
        draft,
        direction,
      });
      change(data.draft);
      await save("save", data.draft);
      setStep(2);
    });
  }
  async function confirm() {
    await action(async () => {
      validateForRender(draft);
      await save("confirm");
      setStep(3);
    });
  }
  async function render() {
    setError("");
    setMessage("");
    setRendering(true);
    setProgress(0);
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      if (draft.narration && !audio)
        throw new Error(
          "Re-upload the saved narration file, or remove it and confirm a silent version.",
        );
      const blob = await renderVideo(draft, setProgress, audio, ctrl.signal);
      replaceVideo(blob, latest?.hash ?? null);
      if (latest) {
        try {
          await cacheVideo(`${draft.id}:${latest.hash}`, blob);
        } catch {
          setMessage(
            "Video is ready. Device storage is full, so download it now.",
          );
        }
      }
      setMessage("Your 15-second preview is ready.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rendering failed.");
    } finally {
      setRendering(false);
    }
  }
  async function switchMarket(market: "US" | "MX") {
    if (market === draft.market) return;
    if (
      draft.shots.length &&
      !(await requestConfirmation(
        "Switching markets clears the current storyboard. Saved versions remain in History.",
      ))
    )
      return;
    change(switchDraftMarket(draft, market));
    setPendingReset(true);
    setDirections([]);
    setStep(0);
    setAudio(undefined);
    setAudioName("");
  }
  async function restore(snapshot: Snapshot) {
    if (
      !(await requestConfirmation(
        `Restore version ${snapshot.version} as a new draft? This replaces the current storyboard, including its locks. Saved versions remain intact.`,
      ))
    )
      return;
    await action(async () => {
      await save(
        "restore",
        { ...snapshot.draft, scriptConfirmed: false },
        snapshot.id,
      );
      replaceVideo(null);
      setStep(2);
      setView("create");
      setAudio(undefined);
      setAudioName("");
    });
  }
  async function reload() {
    if (
      dirty &&
      !(await requestConfirmation(
        "Reload the last saved project? Your unsaved changes will be replaced.",
      ))
    )
      return;
    window.location.reload();
  }
  const blocked = busy || rendering || !loaded;
  return (
    <div className="cp-root">
      {confirmMessage && (
        <div className="cp-confirm-shade">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cp-confirm-title"
            aria-describedby="cp-confirm-message"
            className="cp-confirm-card"
            onKeyDown={(event) => {
              if (event.key === "Escape") finishConfirmation(false);
              if (event.key === "Tab") {
                const buttons = event.currentTarget.querySelectorAll("button");
                if (event.shiftKey && document.activeElement === buttons[0]) {
                  event.preventDefault();
                  buttons[1]?.focus();
                } else if (
                  !event.shiftKey &&
                  document.activeElement === buttons[1]
                ) {
                  event.preventDefault();
                  buttons[0]?.focus();
                }
              }
            }}
          >
            <h2 id="cp-confirm-title">Keep the creative record intact.</h2>
            <p id="cp-confirm-message">{confirmMessage}</p>
            <div>
              <button
                ref={(node) => {
                  node?.focus();
                }}
                className="cp-button cp-button-outline"
                onClick={() => finishConfirmation(false)}
              >
                Keep editing
              </button>
              <button
                className="cp-button cp-button-dark"
                onClick={() => finishConfirmation(true)}
              >
                Continue
              </button>
            </div>
          </section>
        </div>
      )}

      <aside className="cp-sidebar">
        <a
          className="cp-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("create");
          }}
        >
          <span className="cp-mark">
            <Icon size={23} />
          </span>
          <span>
            creative
            <br />
            <b>passport</b>
          </span>
        </a>
        <div className="cp-workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Workspace">
          <button
            className={view === "create" ? "active" : ""}
            onClick={() => setView("create")}
          >
            <Icon name="grid" />
            Creative studio<span className="cp-small-new">V1</span>
          </button>
          <button
            className={view === "versions" ? "active" : ""}
            onClick={() => setView("versions")}
          >
            <Icon name="clock" />
            Version history
            <span className="cp-nav-count">{workspace.versions.length}</span>
          </button>
          <button
            className={view === "about" ? "active" : ""}
            onClick={() => setView("about")}
          >
            <Icon name="film" />
            About this demo
          </button>
        </nav>
        <div className="cp-sidebar-note">
          <span className="cp-mini-compass">✳</span>
          <h3>
            Make it travel.
            <br />
            Keep it true.
          </h3>
          <p>
            Product facts stay grounded.
            <br />
            Creative possibilities stay open.
          </p>
        </div>
        <div className="cp-demo-badge">
          <span>DEMO WORKSPACE</span>
          <strong>
            $0.00 <small>AI spend</small>
          </strong>
          <p>
            Template suggestions.
            <br />
            No paid model calls.
          </p>
        </div>
      </aside>
      <div className="cp-main">
        <header className="cp-topbar">
          <div>
            <span className="cp-breadcrumb">
              Workspace <span>/</span> Creative studio
            </span>
            <span className="cp-save-state">
              {busy
                ? "Saving…"
                : !loaded
                  ? "Connecting…"
                  : dirty
                    ? "Unsaved changes"
                    : workspace.revision
                      ? "Saved to workspace"
                      : "New project"}
            </span>
          </div>
          <button
            className="cp-button cp-button-outline"
            disabled={blocked}
            onClick={() =>
              void action(async () => {
                await save();
              })
            }
          >
            <Icon name="save" size={17} />
            Save project
          </button>
        </header>
        <main className="cp-content">
          {view === "about" ? (
            <section className="cp-about">
              <span className="cp-eyebrow">THE FIRST CHAPTER</span>
              <h1>
                A real workflow.
                <br />
                An honest demo.
              </h1>
              <p>
                This is the first working version of Creative Passport: one
                product, one market, a grounded storyboard, and a real
                downloadable video.
              </p>
              <div className="cp-about-grid">
                <article>
                  <Icon />
                  <h2>Creative hypotheses</h2>
                  <p>
                    Suggestions come from editable templates, not a live
                    language model. Your confirmed product facts are the only
                    source of product claims.
                  </p>
                </article>
                <article>
                  <Icon name="film" />
                  <h2>Actual video, on your device</h2>
                  <p>
                    Your browser encodes a 1080 × 1920 H.264 MP4, at 30 fps for
                    15 seconds. Keep this tab open while it renders. Add your
                    own narration or export a silent captioned preview.
                  </p>
                </article>
                <article>
                  <Icon name="save" />
                  <h2>A saved starting point</h2>
                  <p>
                    Your project and confirmed versions are saved on the
                    backend. Rendered videos are cached on this device and can
                    be recreated from the saved storyboard.
                  </p>
                </article>
                <article>
                  <Icon name="grid" />
                  <h2>Built toward the PRD</h2>
                  <p>
                    Live model generation, server-side production queues, full
                    B0/B1 evaluation, Supabase invite accounts, and complete
                    advertising drafts are the next stages. No ROI or cultural
                    preference is claimed here.
                  </p>
                </article>
              </div>
              <button
                className="cp-button cp-button-dark"
                onClick={() => setView("create")}
              >
                Open creative studio
              </button>
            </section>
          ) : view === "versions" ? (
            <section>
              <span className="cp-eyebrow">YOUR CREATIVE RECORD</span>
              <h1>Every iteration has a story.</h1>
              <p className="cp-lead">
                Confirmed snapshots are kept intact. Restore one as a new draft
                to keep exploring.
              </p>
              {workspace.versions.length ? (
                <div className="cp-history">
                  {[...workspace.versions].reverse().map((snapshot) => (
                    <article key={snapshot.id}>
                      <div className="cp-history-icon">
                        <Icon name="film" />
                      </div>
                      <div>
                        <strong>
                          Version {snapshot.version}{" "}
                          <span className="cp-tag">
                            {snapshot.draft.market} / {snapshot.draft.locale}
                          </span>
                        </strong>
                        <p>{snapshot.draft.shots[0]?.caption}</p>
                        <small>
                          {new Date(snapshot.createdAt).toLocaleString()} · 15
                          seconds ·{" "}
                          {snapshot.draft.shots.filter((s) => s.locked).length}{" "}
                          locked shots
                        </small>
                      </div>
                      <button
                        className="cp-button cp-button-outline"
                        disabled={blocked}
                        onClick={() => void restore(snapshot)}
                      >
                        Restore as draft
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="cp-empty">
                  <Icon name="clock" size={32} />
                  <h2>Your first version starts here.</h2>
                  <p>Confirm a storyboard to create an immutable snapshot.</p>
                  <button
                    className="cp-button cp-button-dark"
                    onClick={() => setView("create")}
                  >
                    Continue creating
                  </button>
                </div>
              )}
            </section>
          ) : (
            <>
              <div className="cp-heading">
                <div>
                  <span className="cp-eyebrow">CREATIVITY, WITH CONTEXT</span>
                  <h1>One product. New possibilities.</h1>
                  <p className="cp-lead">
                    Turn what is true about your product into a story worth
                    exploring.
                  </p>
                </div>
                <div className="cp-format">
                  <span>15 SEC</span>
                  <i />
                  9:16
                  <i />
                  TRAFFIC / WEBSITE
                </div>
              </div>
              <div className="cp-stepper" aria-label="Creation steps">
                {steps.map((label, i) => (
                  <button
                    key={label}
                    className={step === i ? "current" : step > i ? "done" : ""}
                    disabled={
                      blocked ||
                      (i === 1 && !confirmedCount) ||
                      (i > 1 && !draft.shots.length)
                    }
                    onClick={() => {
                      if (i === 1 && !directions.length) void explore();
                      else setStep(i);
                    }}
                  >
                    <span>
                      {step > i ? <Icon name="check" size={15} /> : i + 1}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
              <div className="cp-studio-grid">
                <section className="cp-editor">
                  <fieldset disabled={blocked}>
                    {step === 0 ? (
                      <>
                        <div className="cp-section-heading">
                          <div>
                            <span className="cp-eyebrow">
                              START WITH WHAT IS TRUE
                            </span>
                            <h2>Meet the product.</h2>
                          </div>
                          <span className="cp-tag">
                            {draft.isSample
                              ? "Fictional sample"
                              : "Your product"}
                          </span>
                        </div>
                        <p className="cp-helper">
                          Try the sample, or replace its image and facts with
                          your own. Every advertising claim needs a source and
                          your confirmation.
                        </p>
                        <div className="cp-product-intro">
                          <div className="cp-product-thumbnail">
                            <img
                              src={imageUrl(draft)}
                              alt="Product reference"
                            />
                          </div>
                          <div>
                            <Field label="Product name">
                              <input
                                value={draft.productName}
                                maxLength={70}
                                onChange={(e) =>
                                  change({ productName: e.target.value })
                                }
                              />
                            </Field>
                            <label className="cp-upload">
                              <Icon name="upload" size={17} />
                              Replace product image
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file)
                                    void action(async () => {
                                      const imageDataUrl =
                                        await compressImage(file);
                                      change({
                                        imageDataUrl,
                                        isSample: false,
                                        facts: draft.facts.map((f) => ({
                                          ...f,
                                          confirmed: false,
                                        })),
                                      });
                                    });
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            <small className="cp-muted">
                              JPEG, PNG or WebP · up to 10 MB
                              <br />
                              Resized for the demo; used as image animation.
                            </small>
                          </div>
                        </div>
                        <div className="cp-two-fields">
                          <Field label="Target market">
                            <select
                              value={draft.market}
                              onChange={(e) =>
                                switchMarket(e.target.value as "US" | "MX")
                              }
                            >
                              <option value="US">
                                United States · English
                              </option>
                              <option value="MX">Mexico · Español</option>
                            </select>
                          </Field>
                          <Field label="Brand tone">
                            <input
                              value={draft.brandTone}
                              maxLength={100}
                              onChange={(e) =>
                                change({ brandTone: e.target.value })
                              }
                            />
                          </Field>
                        </div>
                        <Field label="Who is this for?">
                          <input
                            value={draft.audience}
                            maxLength={180}
                            onChange={(e) =>
                              change({ audience: e.target.value })
                            }
                          />
                        </Field>
                        <Field
                          label="A situation to explore"
                          note="A creative hypothesis, not an assumption about a country."
                        >
                          <textarea
                            rows={2}
                            value={draft.scenario}
                            maxLength={240}
                            onChange={(e) =>
                              change({ scenario: e.target.value })
                            }
                          />
                        </Field>
                        <div className="cp-facts-title">
                          <h3>Product facts & evidence</h3>
                          <span>
                            {confirmedCount} of {draft.facts.length} confirmed
                          </span>
                        </div>
                        <div className="cp-facts">
                          {draft.facts.map((fact, index) => (
                            <article
                              className={fact.confirmed ? "confirmed" : ""}
                              key={fact.id}
                            >
                              <Field label={`Fact ${index + 1}`}>
                                <input
                                  value={fact.statement}
                                  placeholder="Enter a product fact"
                                  maxLength={220}
                                  onChange={(e) =>
                                    editFact(index, {
                                      statement: e.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Source / excerpt">
                                <textarea
                                  rows={2}
                                  value={fact.source}
                                  placeholder="Add the source or excerpt"
                                  maxLength={600}
                                  onChange={(e) =>
                                    editFact(index, { source: e.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={`Advertising line · ${draft.locale}`}
                                note="Write this in the advertising language. The demo does not translate your claims automatically."
                              >
                                <input
                                  value={fact.adCopy}
                                  placeholder="Write the advertising line"
                                  maxLength={90}
                                  onChange={(e) =>
                                    editFact(index, { adCopy: e.target.value })
                                  }
                                />
                              </Field>
                              <label className="cp-checkbox">
                                <input
                                  type="checkbox"
                                  checked={fact.confirmed}
                                  disabled={
                                    !fact.statement.trim() ||
                                    !fact.source.trim() ||
                                    !fact.adCopy.trim()
                                  }
                                  onChange={(e) =>
                                    editFact(index, {
                                      confirmed: e.target.checked,
                                    })
                                  }
                                />
                                <span>
                                  {draft.isSample
                                    ? "I have reviewed this fictional sample fact and its example source."
                                    : "I confirm this fact and the source that supports it."}
                                </span>
                              </label>
                            </article>
                          ))}
                        </div>
                        <div className="cp-actions">
                          <button
                            className="cp-text-button"
                            onClick={() => {
                              if (draft.facts.length < 5)
                                change({
                                  facts: [
                                    ...draft.facts,
                                    {
                                      id: crypto.randomUUID(),
                                      statement: "",
                                      source: "",
                                      adCopy: "",
                                      confirmed: false,
                                    },
                                  ],
                                });
                            }}
                            disabled={draft.facts.length >= 5}
                          >
                            ＋ Add a fact
                          </button>
                          <button
                            className="cp-button cp-button-dark"
                            disabled={!confirmedCount}
                            onClick={() => void explore()}
                          >
                            <Icon />
                            Explore 3 directions
                          </button>
                        </div>
                      </>
                    ) : step === 1 ? (
                      <>
                        <div className="cp-section-heading">
                          <div>
                            <span className="cp-eyebrow">
                              THREE WAYS INTO THE STORY
                            </span>
                            <h2>Choose your direction.</h2>
                          </div>
                        </div>
                        <p className="cp-helper">
                          These are template-based creative hypotheses. Pick a
                          starting point, then make the words your own.
                        </p>
                        <div className="cp-direction-list">
                          {directions.map((direction, index) => (
                            <article
                              className="cp-direction-card"
                              key={direction.id}
                            >
                              <div className="cp-direction-top">
                                <span className="cp-tag">
                                  {
                                    [
                                      "SCENARIO LED",
                                      "EVIDENCE LED",
                                      "PRODUCT LED",
                                    ][index]
                                  }
                                </span>
                                <span className="cp-muted">0{index + 1}</span>
                              </div>
                              <h3>{direction.title}</h3>
                              <blockquote>“{direction.hook}”</blockquote>
                              <p>{direction.description}</p>
                              <details>
                                <summary>Why this direction?</summary>
                                <p>{direction.reason}</p>
                                <small>
                                  {direction.factIds.length} confirmed fact
                                  references · Requires local feedback
                                </small>
                              </details>
                              <button
                                className="cp-button cp-button-outline"
                                onClick={() =>
                                  void selectDirection(direction.id)
                                }
                              >
                                Use this direction
                              </button>
                            </article>
                          ))}
                        </div>
                      </>
                    ) : step === 2 ? (
                      <>
                        <div className="cp-section-heading">
                          <div>
                            <span className="cp-eyebrow">
                              MAKE IT SOUND LIKE YOU
                            </span>
                            <h2>Shape the storyboard.</h2>
                          </div>
                          <span className="cp-tag">{draft.locale}</span>
                        </div>
                        <p className="cp-helper">
                          Four shots, one 15-second story. Edit the advertising
                          lines, lock what works, and confirm before rendering.
                          All scenes use your reference image.
                        </p>
                        <div className="cp-shots">
                          {draft.shots.map((shot, index) => (
                            <article
                              className={shot.locked ? "locked" : ""}
                              key={shot.id}
                            >
                              <div className="cp-shot-meta">
                                <strong>
                                  SHOT {String(index + 1).padStart(2, "0")}
                                </strong>
                                <span>{shot.duration} sec</span>
                                <button
                                  className={`cp-lock ${shot.locked ? "active" : ""}`}
                                  aria-label={`${shot.locked ? "Unlock" : "Lock"} shot ${index + 1}`}
                                  onClick={() =>
                                    change({
                                      shots: draft.shots.map((s) =>
                                        s.id === shot.id
                                          ? { ...s, locked: !s.locked }
                                          : s,
                                      ),
                                    })
                                  }
                                >
                                  <Icon name="lock" size={15} />
                                  {shot.locked ? "Locked" : "Lock"}
                                </button>
                              </div>
                              <textarea
                                aria-label={`Shot ${index + 1} caption`}
                                rows={2}
                                maxLength={90}
                                disabled={shot.locked}
                                value={shot.caption}
                                onChange={(e) =>
                                  change({
                                    shots: draft.shots.map((s) =>
                                      s.id === shot.id
                                        ? { ...s, caption: e.target.value }
                                        : s,
                                    ),
                                  })
                                }
                              />
                              <div className="cp-shot-footer">
                                <span>
                                  {shot.factIds.length
                                    ? `Evidence: ${shot.factIds.map((id) => `fact ${draft.facts.findIndex((f) => f.id === id) + 1}`).join(", ")}`
                                    : "Creative framing · no product claim"}
                                </span>
                                <small>{shot.caption.length}/90</small>
                              </div>
                            </article>
                          ))}
                        </div>
                        <div className="cp-context-note">
                          <Icon name="check" size={17} />
                          <span>
                            Same product reference and confirmed facts across
                            all shots. Check the advertising language yourself;
                            no live translation is running.
                          </span>
                        </div>
                        <div className="cp-actions">
                          <button
                            className="cp-text-button"
                            onClick={() => {
                              setStep(1);
                              if (!directions.length) void explore();
                            }}
                          >
                            Revisit directions
                          </button>
                          <button
                            className="cp-button cp-button-dark"
                            onClick={() => void confirm()}
                          >
                            <Icon name="check" size={18} />
                            Confirm script
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="cp-section-heading">
                          <div>
                            <span className="cp-eyebrow">
                              FROM STORYBOARD TO SOMETHING REAL
                            </span>
                            <h2>Your story, in motion.</h2>
                          </div>
                          <span className="cp-tag">
                            {latest ? `VERSION ${latest.version}` : "DRAFT"}
                          </span>
                        </div>
                        <p className="cp-helper">
                          The actual MP4 is encoded on your device. Keep this
                          tab open until it finishes. The default preview is
                          silent, with captions.
                        </p>
                        <div className="cp-render-spec">
                          <div>
                            <span>Format</span>
                            <strong>1080 × 1920</strong>
                          </div>
                          <div>
                            <span>Duration</span>
                            <strong>15 seconds</strong>
                          </div>
                          <div>
                            <span>Frame rate</span>
                            <strong>30 fps</strong>
                          </div>
                          <div>
                            <span>AI cost</span>
                            <strong>$0.00</strong>
                          </div>
                        </div>
                        <Field label="Visual template">
                          <select
                            value={draft.theme}
                            onChange={(e) =>
                              change({
                                theme: e.target.value as Draft["theme"],
                              })
                            }
                          >
                            <option value="forest">Forest · dark green</option>
                            <option value="paper">Paper · clean light</option>
                          </select>
                        </Field>
                        <div className="cp-narration">
                          <h3>
                            Narration <span className="cp-tag">OPTIONAL</span>
                          </h3>
                          <p>
                            Upload audio you have the right to use, up to 15
                            seconds. No automatic TTS is enabled in this demo.
                          </p>
                          <label className="cp-upload">
                            <Icon name="upload" size={17} />
                            {audioName ||
                              draft.narration?.fileName ||
                              "Add your own narration"}
                            <input
                              type="file"
                              accept="audio/wav,audio/mpeg,audio/mp4,audio/ogg"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file)
                                  void action(async () => {
                                    if (file.size > 10 * 1024 * 1024)
                                      throw new Error(
                                        "Use an audio file under 10 MB.",
                                      );
                                    const context = new AudioContext();
                                    try {
                                      const decoded =
                                        await context.decodeAudioData(
                                          await file.arrayBuffer(),
                                        );
                                      if (decoded.duration > 15)
                                        throw new Error(
                                          "Audio exceeds 15 seconds. Please shorten it; it will not be cut.",
                                        );
                                      setAudio(decoded);
                                      setAudioName(file.name);
                                      const digest = await crypto.subtle.digest(
                                        "SHA-256",
                                        await file.arrayBuffer(),
                                      );
                                      const sha256 = Array.from(
                                        new Uint8Array(digest),
                                        (b) => b.toString(16).padStart(2, "0"),
                                      ).join("");
                                      change({
                                        narration: {
                                          fileName: file.name,
                                          sha256,
                                          duration: decoded.duration,
                                        },
                                      });
                                    } finally {
                                      await context.close();
                                    }
                                  });
                                e.target.value = "";
                              }}
                            />
                          </label>
                          {(audioName || draft.narration) && (
                            <button
                              className="cp-text-button"
                              onClick={() => {
                                setAudio(undefined);
                                setAudioName("");
                                change({ narration: null });
                              }}
                            >
                              Remove audio
                            </button>
                          )}
                        </div>
                        {!draft.scriptConfirmed || dirty ? (
                          <div className="cp-callout">
                            This draft has changed. Confirm it to save a new
                            version before rendering.
                            <button
                              className="cp-button cp-button-dark"
                              onClick={() => void confirm()}
                            >
                              Confirm this version
                            </button>
                          </div>
                        ) : (
                          <button
                            className="cp-button cp-button-dark cp-full"
                            onClick={() => void render()}
                          >
                            <Icon name="play" />
                            {video
                              ? "Render again"
                              : "Render 15-second preview"}
                          </button>
                        )}
                        {video &&
                          videoHash === latest?.hash &&
                          draft.scriptConfirmed &&
                          !dirty && (
                            <div className="cp-downloads">
                              <button
                                className="cp-button cp-button-dark"
                                onClick={() =>
                                  downloadBlob(
                                    video,
                                    `creative-passport-${draft.market}-v${latest?.version ?? 1}.mp4`,
                                  )
                                }
                              >
                                <Icon name="download" />
                                Download MP4
                              </button>
                              <button
                                className="cp-button cp-button-outline"
                                onClick={() =>
                                  void action(async () => {
                                    await downloadPackage(
                                      draft,
                                      video,
                                      latest?.version ?? 1,
                                      videoHash!,
                                    );
                                  })
                                }
                              >
                                Download preview package
                              </button>
                              <button
                                className="cp-text-button"
                                onClick={() =>
                                  downloadBlob(
                                    new Blob([makeSrt(draft)], {
                                      type: "text/plain;charset=utf-8",
                                    }),
                                    "captions.srt",
                                  )
                                }
                              >
                                Download SRT captions
                              </button>
                            </div>
                          )}
                        <div className="cp-context-note">
                          <Icon name="film" size={17} />
                          <span>
                            Internal preview, pending human creative review.
                            Traffic / Website context is recorded; advertising
                            budget, identity and destination URL are not
                            configured.
                          </span>
                        </div>
                        <button
                          className="cp-text-button"
                          onClick={() => setStep(2)}
                        >
                          Edit storyboard
                        </button>
                      </>
                    )}
                  </fieldset>
                  {rendering && (
                    <div className="cp-render-progress" role="status">
                      <div>
                        <strong>
                          Encoding your preview… {Math.round(progress * 100)}%
                        </strong>
                        <button
                          className="cp-text-button"
                          onClick={() => controller.current?.abort()}
                        >
                          Cancel
                        </button>
                      </div>
                      <progress value={progress} max={1} />
                      <small>
                        Keep this page open. Your confirmed storyboard is
                        already saved.
                      </small>
                    </div>
                  )}
                </section>
                <aside className="cp-preview-panel">
                  <div className="cp-preview-heading">
                    <span>THE CREATIVE CANVAS</span>
                    <span className="cp-tag">
                      {video ? "RENDERED" : "LIVE LAYOUT"}
                    </span>
                  </div>
                  <PhonePreview draft={draft} videoUrl={videoUrl} />
                  <div className="cp-preview-caption">
                    <Icon name="film" size={17} />
                    <span>
                      {video
                        ? "Actual rendered MP4"
                        : "Product image animation"}{" "}
                      · {draft.market} / {draft.locale}
                    </span>
                  </div>
                  <div className="cp-proof-card">
                    <div>
                      <Icon name="check" size={18} />
                      <strong>Grounded in your product</strong>
                    </div>
                    <p>
                      {confirmedCount} confirmed facts. One shared reference.
                      <br />
                      {draft.isSample
                        ? "Fictional sample · vector illustration."
                        : "Your uploaded image stays the visual source."}
                    </p>
                  </div>
                  <div className="cp-demo-disclosure">
                    <span>AN HONEST FIRST VERSION</span>
                    <p>
                      Directions are editable template suggestions, not live AI
                      output. This demo spends no model credits and makes no
                      advertising performance claims.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {error && (
            <div className="cp-alert cp-alert-error" role="alert">
              <strong>{error}</strong>
              <button className="cp-text-button" onClick={reload}>
                Reload saved project
              </button>
            </div>
          )}
          {message && (
            <div className="cp-alert cp-alert-success" role="status">
              <Icon name="check" size={18} />
              {message}
            </div>
          )}
        </main>
        <footer className="cp-bottom">
          <span>Creative Passport · First working version</span>
          <span>Creative hypotheses. Human decisions.</span>
        </footer>
      </div>
    </div>
  );
}

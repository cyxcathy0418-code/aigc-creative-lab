"use client";
/* eslint-disable @next/next/no-img-element -- Shared with the standalone Worker; uploads are resized on-device and never use a Next.js image proxy. */
import { useState, useEffect, useRef, type ReactNode } from "react";
import { uiText, localizeNotice, readUiLanguage, directionPresentation, LANGUAGE_KEY, type UiLanguage } from "./copy";
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

const stepLabels = [
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
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z" />
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
  language,
}: {
  draft: Draft;
  videoUrl: string | null;
  language: UiLanguage;
}) {
  const t = (text: string) => uiText(language, text);
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
          aria-label={t("Rendered 15-second preview")}
        />
      ) : draft.shots.length ? (
        <canvas
          ref={canvas}
          width="360"
          height="640"
          aria-label={t("First frame of the current storyboard")}
        />
      ) : (
        <div className="cp-phone-empty">
          <img
            src={imageUrl(draft)}
            alt={
              draft.isSample
                ? t("Vector illustration of the fictional ROAM grinder")
                : t("Your product reference")
            }
          />
          <div>
            <small>{t("YOUR PRODUCT. A NEW PERSPECTIVE.")}</small>
            <strong>{draft.productName}</strong>
            <span>{t("Make a little space")}<br />{t("for possibility.")}</span>
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
  const [language, setLanguage] = useState<UiLanguage>("en");
  const t = (text: string, values?: Record<string, string | number>) => uiText(language, text, values);
  const steps = stepLabels.map((label) => t(label));
  useEffect(() => {
    try { setLanguage(readUiLanguage(window.localStorage)); } catch { /* Storage may be unavailable in private browsing. */ }
  }, []);
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = previous; };
  }, [language]);
  function toggleLanguage() {
    const next = language === "en" ? "zh-CN" : "en";
    setLanguage(next);
    try { window.localStorage.setItem(LANGUAGE_KEY, next); } catch { /* The switch still works for this visit. */ }
  }
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
    <div className="cp-root" lang={language}>
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
            <h2 id="cp-confirm-title">{t("Keep the creative record intact.")}</h2>
            <p id="cp-confirm-message">{localizeNotice(language, confirmMessage)}</p>
            <div>
              <button
                ref={(node) => {
                  node?.focus();
                }}
                className="cp-button cp-button-outline"
                onClick={() => finishConfirmation(false)}
              >{t("Keep editing")}</button>
              <button
                className="cp-button cp-button-dark"
                onClick={() => finishConfirmation(true)}
              >{t("Continue")}</button>
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
        <div className="cp-workspace-label">{t("YOUR WORKSPACE")}</div>
        <nav aria-label={t("Workspace")}>
          <button
            className={view === "create" ? "active" : ""}
            onClick={() => setView("create")}
          >
            <Icon name="grid" />{t("Creative studio")}<span className="cp-small-new">V1</span>
          </button>
          <button
            className={view === "versions" ? "active" : ""}
            onClick={() => setView("versions")}
          >
            <Icon name="clock" />{t("Version history")}<span className="cp-nav-count">{workspace.versions.length}</span>
          </button>
          <button
            className={view === "about" ? "active" : ""}
            onClick={() => setView("about")}
          >
            <Icon name="film" />{t("About this demo")}</button>
        </nav>
        <div className="cp-sidebar-note">
          <span className="cp-mini-compass">✳</span>
          <h3>{t("Make it travel.")}<br />{t("Keep it true.")}</h3>
          <p>{t("Product facts stay grounded.")}<br />{t("Creative possibilities stay open.")}</p>
        </div>
        <div className="cp-demo-badge">
          <span>{t("DEMO WORKSPACE")}</span>
          <strong>
            $0.00 <small>{t("AI spend")}</small>
          </strong>
          <p>{t("Template suggestions.")}<br />{t("No paid model calls.")}</p>
        </div>
      </aside>
      <div className="cp-main">
        <header className="cp-topbar">
          <div>
            <span className="cp-breadcrumb">{t("Workspace")}<span>/</span>{t("Creative studio")}</span>
            <span className="cp-save-state">
              {busy
                ? t("Saving…")
                : !loaded
                  ? t("Connecting…")
                  : dirty
                    ? t("Unsaved changes")
                    : workspace.revision
                      ? t("Saved to workspace")
                      : t("New project")}
            </span>
          </div>
          <div className="cp-topbar-actions">
          <button
            className="cp-language-switch"
            type="button"
            onClick={toggleLanguage}
            aria-label={t(language === "en" ? "Switch to Chinese" : "Switch to English")}
            title={t("Interface language only. Advertising copy stays in the target market language.")}
          >
            <Icon name="globe" size={17} />
            <span lang="en" className={language === "en" ? "selected" : ""}>EN</span>
            <span className="cp-language-divider" aria-hidden="true" />
            <span lang="zh-CN" className={language === "zh-CN" ? "selected" : ""}>中文</span>
          </button>
          <button
            className="cp-button cp-button-outline"
            disabled={blocked}
            onClick={() =>
              void action(async () => {
                await save();
              })
            }
          >
            <Icon name="save" size={17} />{t("Save project")}</button>
          </div>
        </header>
        <main className="cp-content">
          {view === "about" ? (
            <section className="cp-about">
              <span className="cp-eyebrow">{t("THE FIRST CHAPTER")}</span>
              <h1>{t("A real workflow.")}<br />{t("An honest demo.")}</h1>
              <p>{t("This is the first working version of Creative Passport: one product, one market, a grounded storyboard, and a real downloadable video.")}</p>
              <div className="cp-about-grid">
                <article>
                  <Icon />
                  <h2>{t("Creative hypotheses")}</h2>
                  <p>{t("Suggestions come from editable templates, not a live language model. Your confirmed product facts are the only source of product claims.")}</p>
                </article>
                <article>
                  <Icon name="film" />
                  <h2>{t("Actual video, on your device")}</h2>
                  <p>{t("Your browser encodes a 1080 × 1920 H.264 MP4, at 30 fps for 15 seconds. Keep this tab open while it renders. Add your own narration or export a silent captioned preview.")}</p>
                </article>
                <article>
                  <Icon name="save" />
                  <h2>{t("A saved starting point")}</h2>
                  <p>{t("Your project and confirmed versions are saved on the backend. Rendered videos are cached on this device and can be recreated from the saved storyboard.")}</p>
                </article>
                <article>
                  <Icon name="grid" />
                  <h2>{t("Built toward the PRD")}</h2>
                  <p>{t("Live model generation, server-side production queues, full B0/B1 evaluation, Supabase invite accounts, and complete advertising drafts are the next stages. No ROI or cultural preference is claimed here.")}</p>
                </article>
              </div>
              <button
                className="cp-button cp-button-dark"
                onClick={() => setView("create")}
              >{t("Open creative studio")}</button>
            </section>
          ) : view === "versions" ? (
            <section>
              <span className="cp-eyebrow">{t("YOUR CREATIVE RECORD")}</span>
              <h1>{t("Every iteration has a story.")}</h1>
              <p className="cp-lead">{t("Confirmed snapshots are kept intact. Restore one as a new draft to keep exploring.")}</p>
              {workspace.versions.length ? (
                <div className="cp-history">
                  {[...workspace.versions].reverse().map((snapshot) => (
                    <article key={snapshot.id}>
                      <div className="cp-history-icon">
                        <Icon name="film" />
                      </div>
                      <div>
                        <strong>{t("Version")}{" "}{snapshot.version}{" "}
                          <span className="cp-tag">
                            {snapshot.draft.market} / {snapshot.draft.locale}
                          </span>
                        </strong>
                        <p>{snapshot.draft.shots[0]?.caption}</p>
                        <small>
                          {new Date(snapshot.createdAt).toLocaleString(language === "zh-CN" ? "zh-CN" : "en-US")}{t("· 15 seconds ·")}{" "}
                          {snapshot.draft.shots.filter((s) => s.locked).length}{" "}{t("locked shots")}</small>
                      </div>
                      <button
                        className="cp-button cp-button-outline"
                        disabled={blocked}
                        onClick={() => void restore(snapshot)}
                      >{t("Restore as draft")}</button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="cp-empty">
                  <Icon name="clock" size={32} />
                  <h2>{t("Your first version starts here.")}</h2>
                  <p>{t("Confirm a storyboard to create an immutable snapshot.")}</p>
                  <button
                    className="cp-button cp-button-dark"
                    onClick={() => setView("create")}
                  >{t("Continue creating")}</button>
                </div>
              )}
            </section>
          ) : (
            <>
              <div className="cp-heading">
                <div>
                  <span className="cp-eyebrow">{t("CREATIVITY, WITH CONTEXT")}</span>
                  <h1>{t("One product. New possibilities.")}</h1>
                  <p className="cp-lead">{t("Turn what is true about your product into a story worth exploring.")}</p>
                </div>
                <div className="cp-format">
                  <span>{t("15 SEC")}</span>
                  <i />
                  9:16
                  <i />{t("TRAFFIC / WEBSITE")}</div>
              </div>
              <div className="cp-stepper" aria-label={t("Creation steps")}>
                {steps.map((label, i) => (
                  <button
                    key={stepLabels[i]}
                    aria-current={step === i ? "step" : undefined}
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
                            <span className="cp-eyebrow">{t("START WITH WHAT IS TRUE")}</span>
                            <h2>{t("Meet the product.")}</h2>
                          </div>
                          <span className="cp-tag">
                            {draft.isSample
                              ? t("Fictional sample")
                              : t("Your product")}
                          </span>
                        </div>
                        <p className="cp-helper">{t("Try the sample, or replace its image and facts with your own. Every advertising claim needs a source and your confirmation.")}</p>
                        <div className="cp-product-intro">
                          <div className="cp-product-thumbnail">
                            <img
                              src={imageUrl(draft)}
                              alt={t("Product reference")}
                            />
                          </div>
                          <div>
                            <Field label={t("Product name")}>
                              <input
                                value={draft.productName}
                                maxLength={70}
                                onChange={(e) =>
                                  change({ productName: e.target.value })
                                }
                              />
                            </Field>
                            <label className="cp-upload">
                              <Icon name="upload" size={17} />{t("Replace product image")}<input
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
                            <small className="cp-muted">{t("JPEG, PNG or WebP · up to 10 MB")}<br />{t("Resized for the demo; used as image animation.")}</small>
                          </div>
                        </div>
                        <div className="cp-two-fields">
              <Field label={t("Target market")} note={t("Interface language only. Advertising copy stays in the target market language.")}>
                            <select
                              value={draft.market}
                              onChange={(e) =>
                                switchMarket(e.target.value as "US" | "MX")
                              }
                            >
                              <option value="US">{t("United States · English")}</option>
                              <option value="MX">{t("Mexico · Español")}</option>
                            </select>
                          </Field>
                          <Field label={t("Brand tone")}>
                            <input
                              value={draft.brandTone}
                              maxLength={100}
                              onChange={(e) =>
                                change({ brandTone: e.target.value })
                              }
                            />
                          </Field>
                        </div>
                        <Field label={t("Who is this for?")}>
                          <input
                            value={draft.audience}
                            maxLength={180}
                            onChange={(e) =>
                              change({ audience: e.target.value })
                            }
                          />
                        </Field>
                        <Field
                          label={t("A situation to explore")}
                          note={t("A creative hypothesis, not an assumption about a country.")}
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
                          <h3>{t("Product facts & evidence")}</h3>
                          <span>
                            {t("Confirmed {count} of {total}", { count: confirmedCount, total: draft.facts.length })}</span>
                        </div>
                        <div className="cp-facts">
                          {draft.facts.map((fact, index) => (
                            <article
                              className={fact.confirmed ? "confirmed" : ""}
                              key={fact.id}
                            >
                              <Field label={t("Fact {number}", { number: index + 1 })}>
                                <input
                                  value={fact.statement}
                                  placeholder={t("Enter a product fact")}
                                  maxLength={220}
                                  onChange={(e) =>
                                    editFact(index, {
                                      statement: e.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field label={t("Source / excerpt")}>
                                <textarea
                                  rows={2}
                                  value={fact.source}
                                  placeholder={t("Add the source or excerpt")}
                                  maxLength={600}
                                  onChange={(e) =>
                                    editFact(index, { source: e.target.value })
                                  }
                                />
                              </Field>
                              <Field
                                label={t("Advertising line · {locale}", { locale: draft.locale })}
                                note={t("Write this in the advertising language. The demo does not translate your claims automatically.")}
                              >
                                <input
                                  value={fact.adCopy}
                                  lang={draft.locale}
                                  placeholder={t("Write the advertising line")}
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
                                    ? t("I have reviewed this fictional sample fact and its example source.")
                                    : t("I confirm this fact and the source that supports it.")}
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
                          >{t("＋ Add a fact")}</button>
                          <button
                            className="cp-button cp-button-dark"
                            disabled={!confirmedCount}
                            onClick={() => void explore()}
                          >
                            <Icon />{t("Explore 3 directions")}</button>
                        </div>
                      </>
                    ) : step === 1 ? (
                      <>
                        <div className="cp-section-heading">
                          <div>
                            <span className="cp-eyebrow">{t("THREE WAYS INTO THE STORY")}</span>
                            <h2>{t("Choose your direction.")}</h2>
                          </div>
                        </div>
                        <p className="cp-helper">{t("These are template-based creative hypotheses. Pick a starting point, then make the words your own.")}</p>
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
                                      t("SCENARIO LED"),
                                      t("EVIDENCE LED"),
                                      t("PRODUCT LED"),
                                    ][index]
                                  }
                                </span>
                                <span className="cp-muted">0{index + 1}</span>
                              </div>
                              <h3>{directionPresentation(language, direction, draft).title}</h3>
                              <blockquote lang={draft.locale}>“{direction.hook}”</blockquote>
                              <p>{directionPresentation(language, direction, draft).description}</p>
                              <details>
                                <summary>{t("Why this direction?")}</summary>
                                <p>{directionPresentation(language, direction, draft).reason}</p>
                                <small>
                                  {direction.factIds.length}{t("confirmed fact references · Requires local feedback")}</small>
                              </details>
                              <button
                                className="cp-button cp-button-outline"
                                onClick={() =>
                                  void selectDirection(direction.id)
                                }
                              >{t("Use this direction")}</button>
                            </article>
                          ))}
                        </div>
                      </>
                    ) : step === 2 ? (
                      <>
                        <div className="cp-section-heading">
                          <div>
                            <span className="cp-eyebrow">{t("MAKE IT SOUND LIKE YOU")}</span>
                            <h2>{t("Shape the storyboard.")}</h2>
                          </div>
                          <span className="cp-tag">{draft.locale}</span>
                        </div>
                        <p className="cp-helper">{t("Four shots, one 15-second story. Edit the advertising lines, lock what works, and confirm before rendering. All scenes use your reference image.")}</p>
                        <div className="cp-shots">
                          {draft.shots.map((shot, index) => (
                            <article
                              className={shot.locked ? "locked" : ""}
                              key={shot.id}
                            >
                              <div className="cp-shot-meta">
                                <strong>{t("SHOT")}{String(index + 1).padStart(2, "0")}
                                </strong>
                                <span>{shot.duration}{t("sec")}</span>
                                <button
                                  className={`cp-lock ${shot.locked ? "active" : ""}`}
                                  aria-label={t(shot.locked ? "Unlock shot {number}" : "Lock shot {number}", { number: index + 1 })}
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
                                  {t(shot.locked ? "Locked" : "Lock")}
                                </button>
                              </div>
                              <textarea
                                aria-label={t("Shot {number} caption", { number: index + 1 })}
                                lang={draft.locale}
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
                                    ? t("Evidence: {facts}", { facts: shot.factIds.map((id) => t("Fact {number}", { number: draft.facts.findIndex((f) => f.id === id) + 1 })).join(", ") })
                                    : t("Creative framing · no product claim")}
                                </span>
                                <small>{shot.caption.length}/90</small>
                              </div>
                            </article>
                          ))}
                        </div>
                        <div className="cp-context-note">
                          <Icon name="check" size={17} />
                          <span>{t("Same product reference and confirmed facts across all shots. Check the advertising language yourself; no live translation is running.")}</span>
                        </div>
                        <div className="cp-actions">
                          <button
                            className="cp-text-button"
                            onClick={() => {
                              setStep(1);
                              if (!directions.length) void explore();
                            }}
                          >{t("Revisit directions")}</button>
                          <button
                            className="cp-button cp-button-dark"
                            onClick={() => void confirm()}
                          >
                            <Icon name="check" size={18} />{t("Confirm script")}</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="cp-section-heading">
                          <div>
                            <span className="cp-eyebrow">{t("FROM STORYBOARD TO SOMETHING REAL")}</span>
                            <h2>{t("Your story, in motion.")}</h2>
                          </div>
                          <span className="cp-tag">
                            {latest ? t("VERSION {number}", { number: latest.version }) : t("DRAFT")}
                          </span>
                        </div>
                        <p className="cp-helper">{t("The actual MP4 is encoded on your device. Keep this tab open until it finishes. The default preview is silent, with captions.")}</p>
                        <div className="cp-render-spec">
                          <div>
                            <span>{t("Format")}</span>
                            <strong>1080 × 1920</strong>
                          </div>
                          <div>
                            <span>{t("Duration")}</span>
                            <strong>{t("15 seconds")}</strong>
                          </div>
                          <div>
                            <span>{t("Frame rate")}</span>
                            <strong>{t("30 fps")}</strong>
                          </div>
                          <div>
                            <span>{t("AI cost")}</span>
                            <strong>$0.00</strong>
                          </div>
                        </div>
                        <Field label={t("Visual template")}>
                          <select
                            value={draft.theme}
                            onChange={(e) =>
                              change({
                                theme: e.target.value as Draft["theme"],
                              })
                            }
                          >
                            <option value="forest">{t("Forest · dark green")}</option>
                            <option value="paper">{t("Paper · clean light")}</option>
                          </select>
                        </Field>
                        <div className="cp-narration">
                          <h3>{t("Narration")}<span className="cp-tag">{t("OPTIONAL")}</span>
                          </h3>
                          <p>{t("Upload audio you have the right to use, up to 15 seconds. No automatic TTS is enabled in this demo.")}</p>
                          <label className="cp-upload">
                            <Icon name="upload" size={17} />
                            {audioName ||
                              draft.narration?.fileName ||
                              t("Add your own narration")}
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
                            >{t("Remove audio")}</button>
                          )}
                        </div>
                        {!draft.scriptConfirmed || dirty ? (
                          <div className="cp-callout">{t("This draft has changed. Confirm it to save a new version before rendering.")}<button
                              className="cp-button cp-button-dark"
                              onClick={() => void confirm()}
                            >{t("Confirm this version")}</button>
                          </div>
                        ) : (
                          <button
                            className="cp-button cp-button-dark cp-full"
                            onClick={() => void render()}
                          >
                            <Icon name="play" />
                            {video
                              ? t("Render again")
                              : t("Render 15-second preview")}
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
                                <Icon name="download" />{t("Download MP4")}</button>
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
                              >{t("Download preview package")}</button>
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
                              >{t("Download SRT captions")}</button>
                            </div>
                          )}
                        <div className="cp-context-note">
                          <Icon name="film" size={17} />
                          <span>{t("Internal preview, pending human creative review. Traffic / Website context is recorded; advertising budget, identity and destination URL are not configured.")}</span>
                        </div>
                        <button
                          className="cp-text-button"
                          onClick={() => setStep(2)}
                        >{t("Edit storyboard")}</button>
                      </>
                    )}
                  </fieldset>
                  {rendering && (
                    <div className="cp-render-progress" role="status">
                      <div>
                        <strong>{t("Encoding your preview…")}{Math.round(progress * 100)}%
                        </strong>
                        <button
                          className="cp-text-button"
                          onClick={() => controller.current?.abort()}
                        >{t("Cancel")}</button>
                      </div>
                      <progress value={progress} max={1} />
                      <small>{t("Keep this page open. Your confirmed storyboard is already saved.")}</small>
                    </div>
                  )}
                </section>
                <aside className="cp-preview-panel">
                  <div className="cp-preview-heading">
                    <span>{t("THE CREATIVE CANVAS")}</span>
                    <span className="cp-tag">
                      {t(video ? "RENDERED" : "LIVE LAYOUT")}
                    </span>
                  </div>
                  <PhonePreview draft={draft} videoUrl={videoUrl} language={language} />
                  <div className="cp-preview-caption">
                    <Icon name="film" size={17} />
                    <span>
                      {video
                        ? t("Actual rendered MP4")
                        : t("Product image animation")}{" "}
                      · {draft.market} / {draft.locale}
                    </span>
                  </div>
                  <div className="cp-proof-card">
                    <div>
                      <Icon name="check" size={18} />
                      <strong>{t("Grounded in your product")}</strong>
                    </div>
                    <p>
                      {confirmedCount}{t("confirmed facts. One shared reference.")}<br />
                      {draft.isSample
                        ? t("Fictional sample · vector illustration.")
                        : t("Your uploaded image stays the visual source.")}
                    </p>
                  </div>
                  <div className="cp-demo-disclosure">
                    <span>{t("AN HONEST FIRST VERSION")}</span>
                    <p>{t("Directions are editable template suggestions, not live AI output. This demo spends no model credits and makes no advertising performance claims.")}</p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {error && (
            <div className="cp-alert cp-alert-error" role="alert">
              <strong>{localizeNotice(language, error)}</strong>
              <button className="cp-text-button" onClick={reload}>{t("Reload saved project")}</button>
            </div>
          )}
          {message && (
            <div className="cp-alert cp-alert-success" role="status">
              <Icon name="check" size={18} />
              {localizeNotice(language, message)}
            </div>
          )}
        </main>
        <footer className="cp-bottom">
          <span>{t("Creative Passport · First working version")}</span>
          <span>{t("Creative hypotheses. Human decisions.")}</span>
        </footer>
      </div>
    </div>
  );
}

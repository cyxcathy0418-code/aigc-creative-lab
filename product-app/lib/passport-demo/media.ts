import { validateForRender, makeSrt, type Draft } from "./workflow.ts";
import { sampleImageUrl } from "./sample-art.ts";
export function imageUrl(draft: Draft) {
  return draft.imageDataUrl === "sample:coffee"
    ? sampleImageUrl()
    : draft.imageDataUrl;
}
export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          "Could not decode this image. Please upload a JPEG, PNG or WebP.",
        ),
      );
    image.src = url;
  });
}
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth) {
      if (line) lines.push(line);
      if (ctx.measureText(word).width > maxWidth)
        throw new Error(
          "A caption word is too wide. Shorten it before rendering.",
        );
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  draft: Draft,
  image: CanvasImageSource,
  time: number,
) {
  const { width: w } = ctx.canvas;
  const scale = w / 1080;
  ctx.save();
  ctx.scale(scale, scale);
  const paper = draft.theme === "paper";
  ctx.fillStyle = paper ? "#f5f7f1" : "#132f25";
  ctx.fillRect(0, 0, 1080, 1920);
  const secondary = paper ? "#354c3a" : "#d5e2c3";
  const primary = paper ? "#163627" : "#f4f6e8";
  ctx.fillStyle = secondary;
  ctx.font = "500 22px Arial";
  ctx.fillText("CREATIVE PASSPORT", 68, 98);
  ctx.textAlign = "right";
  ctx.fillText(draft.market === "US" ? "EN / US" : "ES / MX", 1012, 98);
  ctx.textAlign = "left";
  ctx.font = "600 39px Arial";
  const names = wrap(ctx, draft.productName, 944);
  if (names.length > 2)
    throw new Error("Shorten the product name for this layout.");
  names.forEach((line, i) => ctx.fillText(line, 68, 180 + i * 48));
  let start = 0;
  let index = draft.shots.length - 1;
  for (let i = 0; i < draft.shots.length; i++) {
    if (time < start + draft.shots[i].duration) {
      index = i;
      break;
    }
    start += draft.shots[i].duration;
  }
  const shot = draft.shots[index];
  const progress = Math.max(0, Math.min(1, (time - start) / shot.duration));
  const source = image as HTMLImageElement;
  const iw = source.naturalWidth ?? (source.width as number);
  const ih = source.naturalHeight ?? (source.height as number);
  const box = { x: 68, y: 310, w: 944, h: 1050 };
  const fit = Math.min(box.w / iw, box.h / ih) * (0.94 + 0.025 * progress);
  const dw = iw * fit,
    dh = ih * fit;
  ctx.fillStyle = paper ? "#e8eee4" : "#214334";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.drawImage(
    image,
    box.x + (box.w - dw) / 2,
    box.y + (box.h - dh) / 2,
    dw,
    dh,
  );
  ctx.fillStyle = primary;
  ctx.font = "600 59px Arial";
  const lines = wrap(ctx, shot.caption, 900);
  if (lines.length > 3)
    throw new Error(`Shot ${index + 1}: shorten the caption to three lines.`);
  const top = 1452 + (3 - lines.length) * 24;
  lines.forEach((line, i) => ctx.fillText(line, 68, top + i * 77));
  ctx.fillStyle = secondary;
  ctx.font = "400 21px Arial";
  ctx.fillText(
    draft.isSample
      ? "FICTIONAL SAMPLE · INTERNAL PREVIEW"
      : "INTERNAL PREVIEW · IMAGE ANIMATION",
    68,
    1794,
  );
  ctx.fillStyle = paper ? "#c8d1c5" : "#45604c";
  ctx.fillRect(68, 1840, 944, 4);
  ctx.fillStyle = paper ? "#31553a" : "#deeb8e";
  ctx.fillRect(68, 1840, 944 * Math.min(1, time / 15), 4);
  ctx.font = "400 20px Arial";
  ctx.fillText(`${String(index + 1).padStart(2, "0")} / 04`, 68, 1888);
  ctx.textAlign = "right";
  ctx.fillText("15 SEC · 9:16", 1012, 1888);
  ctx.restore();
}
export async function renderVideo(
  draft: Draft,
  onProgress: (p: number) => void,
  audio?: AudioBuffer,
  signal?: AbortSignal,
): Promise<Blob> {
  validateForRender(draft);
  if (!draft.scriptConfirmed)
    throw new Error("Confirm and save this script first.");
  if (!("VideoEncoder" in window))
    throw new Error(
      "MP4 rendering needs a recent desktop Chrome or Edge browser.",
    );
  if (audio && audio.duration > 15)
    throw new Error(
      "Your narration is longer than 15 seconds. Please shorten it; it will not be cut automatically.",
    );
  const bunny = await import("mediabunny");
  const supported = await bunny.canEncodeVideo("avc", {
    width: 1080,
    height: 1920,
  });
  if (!supported)
    throw new Error(
      "H.264 encoding is unavailable. Try desktop Chrome on a computer with video encoding support.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable.");
  const image = await loadImage(imageUrl(draft));
  // Preflight every shot before committing time to encoding.
  let stamp = 0;
  for (const shot of draft.shots) {
    drawFrame(ctx, draft, image, stamp + 0.01);
    stamp += shot.duration;
  }
  const target = new bunny.BufferTarget();
  const output = new bunny.Output({
    format: new bunny.Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const source = new bunny.CanvasSource(canvas, {
    codec: "avc",
    bitrate: 3_000_000,
  });
  output.addVideoTrack(source, { frameRate: 30 });
  let audioSource: InstanceType<typeof bunny.AudioBufferSource> | undefined;
  if (audio) {
    if (
      !(await bunny.canEncodeAudio("aac", {
        numberOfChannels: audio.numberOfChannels,
        sampleRate: audio.sampleRate,
      }))
    )
      throw new Error(
        "AAC audio encoding is unavailable in this browser. Try another browser or render the silent preview.",
      );
    audioSource = new bunny.AudioBufferSource({
      codec: "aac",
      bitrate: 128_000,
    });
    output.addAudioTrack(audioSource);
  }
  try {
    await output.start();
    if (audioSource && audio) {
      await audioSource.add(audio);
      audioSource.close();
    }
    for (let frame = 0; frame < 450; frame++) {
      if (signal?.aborted)
        throw new Error("Rendering cancelled. Your confirmed script is saved.");
      drawFrame(ctx, draft, image, frame / 30);
      await source.add(frame / 30, 1 / 30);
      if (frame % 9 === 0) {
        onProgress((frame + 1) / 450);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    source.close();
    await output.finalize();
    if (!target.buffer) throw new Error("The encoder returned no video.");
    onProgress(1);
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
}
export async function compressImage(file: File): Promise<string> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("Use a JPEG, PNG or WebP under 10 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const valid =
    (file.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) ||
    (file.type === "image/png" &&
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71) ||
    (file.type === "image/webp" &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP");
  if (!valid) throw new Error("The file contents do not match its image type.");
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(blobUrl);
    if (img.naturalWidth * img.naturalHeight > 40_000_000)
      throw new Error(
        "This image is too large to decode safely. Resize it first.",
      );
    const ratio = Math.min(
      1,
      1280 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.84);
    if (data.length > 1_400_000) throw new Error("Please use a smaller image.");
    return data;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export async function downloadPackage(
  draft: Draft,
  video: Blob,
  version: number,
) {
  const { zipSync, strToU8 } = await import("fflate");
  const manifest = {
    product: draft.productName,
    market: draft.market,
    locale: draft.locale,
    version,
    provider: "demo-template-v1",
    aiCostUSD: 0,
    status: "internal_preview",
    voice: draft.narration
      ? { mode: "user_uploaded", ...draft.narration }
      : { mode: "silent", paidTTS: false },
    format: "1080x1920 / 30fps / 15s",
    facts: draft.facts,
    shots: draft.shots,
    advertisingContext: {
      objective: "TRAFFIC",
      destination: "WEBSITE",
      platformStatus: "not_connected",
      budget: "not_configured",
    },
  };
  const zip = zipSync(
    {
      "preview.mp4": new Uint8Array(await video.arrayBuffer()),
      "captions.srt": strToU8(makeSrt(draft)),
      "creative-passport.json": strToU8(JSON.stringify(manifest, null, 2)),
      "READ-ME.txt": strToU8(
        "INTERNAL PREVIEW.\nTemplate suggestions, not live AI output.\nHuman fact and language review required.\nNo advertising performance has been measured.\n",
      ),
    },
    { level: 0 },
  );
  downloadBlob(
    new Blob([zip as BlobPart], { type: "application/zip" }),
    `creative-passport-${draft.market}-v${version}.zip`,
  );
}

const images = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const portraits = new Set(["image/jpeg", "image/png", "image/webp"]);
const videos = new Set(["video/mp4", "video/webm"]);

export function allowedUpload(purpose: "profile" | "board" | "post", contentType: string, size: number) {
  const isImage = (purpose === "post" ? images : portraits).has(contentType);
  const maxBytes = purpose !== "post" ? 4 * 1024 * 1024
    : contentType.startsWith("video/") ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
  return (isImage || (purpose === "post" && videos.has(contentType)))
    && Number.isSafeInteger(size) && size > 0 && size <= maxBytes;
}

// Reject disguised HTML/executables even if their uploaded MIME metadata is allowed.
// This is a container-signature check, not a malware scan or complete media decoder.
export function hasMediaSignature(bytes: Buffer, type: string) {
  const text = (start: number, end: number) => bytes.toString("ascii", start, end);
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(text(0, 6));
  if (type === "image/webp") return bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  if (type === "video/webm") return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (type === "video/mp4") return bytes.length >= 12 && text(4, 8) === "ftyp";
  return false;
}

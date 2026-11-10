/**
 * Expected parser failures are client errors, not application exceptions.
 * Never echo/log parser messages or their `body` property: they contain input.
 */
export function requestBodyError(error: unknown): { status: number; message: string } | null {
  if (!error || typeof error !== "object" || !("type" in error)) return null;
  switch (error.type) {
    case "entity.parse.failed":
      return { status: 400, message: "The request body must contain valid JSON." };
    case "entity.too.large":
    case "parameters.too.many":
      return { status: 413, message: "This request is too large." };
    case "encoding.unsupported":
    case "charset.unsupported":
      return { status: 415, message: "This request uses an unsupported encoding." };
    case "request.aborted":
    case "request.size.invalid":
      return { status: 400, message: "The request body was incomplete. Please try again." };
    default:
      return null;
  }
}

import { randomUUID } from "crypto";
import { Readable } from "stream";
import { File, Storage } from "@google-cloud/storage";
import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
  type ObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

export class ObjectStorageService {
  getPrivateObjectDir(): string {
    const path = process.env.PRIVATE_OBJECT_DIR || "";
    if (!path) throw new Error("PRIVATE_OBJECT_DIR is not configured");
    return path;
  }

  async getObjectEntityUploadURL(): Promise<{ uploadURL: string; objectPath: string }> {
    const fullPath = `${this.getPrivateObjectDir()}/uploads/${randomUUID()}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const uploadURL = await signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
    return {
      uploadURL,
      objectPath: this.normalizeObjectEntityPath(fullPath),
    };
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId || entityId.includes("..")) throw new ObjectNotFoundError();
    const entityDir = this.getPrivateObjectDir().replace(/\/$/, "");
    const { bucketName, objectName } = parseObjectPath(`${entityDir}/${entityId}`);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async finalizeVerifiedUpload(file: File, generation: string): Promise<string> {
    const finalPath = `${this.getPrivateObjectDir()}/assets/${randomUUID()}`;
    const { bucketName, objectName } = parseObjectPath(finalPath);
    const destination = objectStorageClient.bucket(bucketName).file(objectName);
    const verifiedSource = file.bucket.file(file.name, { generation });
    await verifiedSource.copy(destination, { preconditionOpts: { ifGenerationMatch: 0 } });
    await verifiedSource.delete({ ignoreNotFound: true });
    return this.normalizeObjectEntityPath(finalPath);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    const privateDir = this.getPrivateObjectDir().replace(/\/$/, "");
    if (!rawPath.startsWith(`${privateDir}/`)) return rawPath;
    return `/objects/${rawPath.slice(privateDir.length + 1)}`;
  }

  async downloadObject(file: File, cacheTtlSec = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const policy = await getObjectAclPolicy(file);
    const nodeStream = file.createReadStream();
    const body = Readable.toWeb(nodeStream) as ReadableStream;
    return new Response(body, {
      headers: {
        "Content-Type": String(metadata.contentType || "application/octet-stream"),
        "Cache-Control": `${policy?.visibility === "public" ? "public" : "private"}, max-age=${cacheTtlSec}`,
        ...(metadata.size ? { "Content-Length": String(metadata.size) } : {}),
      },
    });
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    policy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, policy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const parts = path.startsWith("/") ? path.split("/") : `/${path}`.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid object path");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Failed to sign object URL (${response.status})`);
  const body = (await response.json()) as { signed_url?: string };
  if (!body.signed_url) throw new Error("Storage service returned no signed URL");
  return body.signed_url;
}

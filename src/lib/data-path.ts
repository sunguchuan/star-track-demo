import { tmpdir } from "os";
import { join } from "path";

/** Serverless hosts ship a read-only project dir; only the OS temp dir is writable. */
export function isReadOnlyHost(): boolean {
  return (
    process.env.VERCEL === "1" ||
    Boolean(process.env.VERCEL_ENV) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    process.env.NETLIFY === "true"
  );
}

/**
 * Location for local SQLite files: `./data` in dev, temp dir on hosted platforms.
 * Hosted data is ephemeral (reset on cold start), which is fine for demo stores.
 */
export function dataFilePath(filename: string): string {
  const dir = isReadOnlyHost()
    ? join(tmpdir(), "startrail-data")
    : join(process.cwd(), "data");
  return join(dir, filename);
}

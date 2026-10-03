/**
 * Lets `node --test` run src/*.ts directly (Node ≥ 22.18 strips types natively).
 * Resolves the `@/` alias and extensionless relative imports the way the bundler does.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(import.meta.dirname, "../../src");
const CANDIDATES = [".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = path.join(SRC, specifier.slice(2));
    } else if (
      /^\.\.?\//.test(specifier) &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }

    if (base) {
      for (const suffix of CANDIDATES) {
        if (existsSync(base + suffix)) {
          return nextResolve(pathToFileURL(base + suffix).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

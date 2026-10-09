import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  const destination = path.join(root, "public/pdfjs", directory);
  await mkdir(destination, { recursive: true });
  await cp(path.join(root, "node_modules/pdfjs-dist", directory), destination, {
    recursive: true,
  });
}

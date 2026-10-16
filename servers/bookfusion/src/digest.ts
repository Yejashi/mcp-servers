// The file digest BookFusion's Calibre API identifies uploads by. It must
// match the Calibre plugin byte for byte, or "is this book already there?"
// never matches: sha256 over `size` zero bytes (Python's bytes(n)), a NUL,
// then the file.

import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

export async function bookDigest(path: string): Promise<string> {
  const size = statSync(path).size;
  const h = createHash("sha256");
  // bytes(size) in the plugin is `size` zero bytes, not the decimal digits.
  const zeros = Buffer.alloc(Math.min(size, 1 << 20));
  for (let left = size; left > 0; left -= zeros.length) h.update(left >= zeros.length ? zeros : zeros.subarray(0, left));
  h.update(Buffer.from([0]));
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

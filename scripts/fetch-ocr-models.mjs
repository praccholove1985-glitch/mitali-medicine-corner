import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = join(process.cwd(), "public", "models");
const modelAssets = [
  {
    name: "ch_PP-OCRv4_det_infer.onnx",
    size: 4_745_517,
    sha256: "30a86f5731181461d08021402766601e4302a9b9b9666be8aff402696339cdff",
  },
  {
    name: "ch_PP-OCRv4_rec_infer.onnx",
    size: 10_822_323,
    sha256: "06b3e6af6c59a1ba5d53790ed8c2e4b2de389870b6cf5a97f349f3412cb269c0",
  },
  {
    name: "ppocr_keys_v1.txt",
    size: 26_249,
    sha256: "28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7",
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function isValidAsset(path, asset) {
  try {
    const bytes = await readFile(path);
    return bytes.byteLength === asset.size && sha256(bytes) === asset.sha256;
  } catch {
    return false;
  }
}

await mkdir(outputDir, { recursive: true });

for (const asset of modelAssets) {
  const path = join(outputDir, asset.name);
  if (await isValidAsset(path, asset)) {
    console.log(`OCR model already present: ${asset.name}`);
    continue;
  }

  const url = `https://github.com/gutenye/ocr/releases/download/models-v1/${asset.name}`;
  console.log(`Downloading local OCR asset: ${asset.name}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Could not download ${asset.name}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== asset.size || sha256(bytes) !== asset.sha256) {
    throw new Error(`OCR asset failed size or SHA-256 verification: ${asset.name}`);
  }
  await writeFile(path, bytes);
}

console.log("Verified PaddleOCR model assets are ready.");

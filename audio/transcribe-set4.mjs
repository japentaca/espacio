#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCENE_DEFINITION_FILE = path.join(__dirname, "..", "scene.definition.json");
const CACHE_FILE = path.join(__dirname, "set4.transcripts.json");
const STT_PROVIDER = (process.env.STT_PROVIDER || "openrouter").toLowerCase();
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_STT_MODEL || "openai/whisper-1";
const OPENAI_MODEL = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";
const GROQ_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo";
const LANGUAGE = process.env.OPENROUTER_STT_LANGUAGE || "es";
const REQUEST_DELAY_MS = Number.parseInt(
  process.env.STT_DELAY_MS || process.env.OPENROUTER_STT_DELAY_MS || "5000",
  10
);

const args = new Set(process.argv.slice(2));
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const onlyPath = onlyArg ? onlyArg.slice("--only=".length).trim() : "";
const dryRun = args.has("--dry-run");
const force = args.has("--force");

async function loadEnvFile() {
  const envPath = path.resolve(__dirname, "..", "..", ".env");

  let raw = "";
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function loadSceneDefinition() {
  const raw = await fs.readFile(SCENE_DEFINITION_FILE, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("scene.definition.json no contiene un objeto valido");
  }

  const set4Files = parsed?.audioSetLibrary?.set4?.files;
  if (!Array.isArray(set4Files)) {
    throw new Error("No se encontro audioSetLibrary.set4.files en scene.definition.json");
  }

  return parsed;
}

function getSet4Files(sceneDefinition) {
  return sceneDefinition.audioSetLibrary.set4.files;
}

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  const sorted = Object.fromEntries(
    Object.entries(cache).sort((a, b) => a[0].localeCompare(b[0]))
  );
  await fs.writeFile(CACHE_FILE, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function transcribeFile({ absoluteFilePath, relativePath, apiKey }) {
  const fileBuffer = await fs.readFile(absoluteFilePath);
  const form = new FormData();

  form.append("file", new Blob([fileBuffer]), path.basename(absoluteFilePath));

  let endpoint = "";
  let headers = {};

  if (STT_PROVIDER === "openrouter") {
    endpoint = `${OPENROUTER_BASE_URL.replace(/\/$/, "")}/audio/transcriptions`;
    form.append("model", OPENROUTER_MODEL);
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://localhost/mi-web",
      "X-Title": "mi-web set4 transcription"
    };
  } else if (STT_PROVIDER === "openai") {
    endpoint = "https://api.openai.com/v1/audio/transcriptions";
    form.append("model", OPENAI_MODEL);
    headers = {
      Authorization: `Bearer ${apiKey}`
    };
  } else if (STT_PROVIDER === "groq") {
    endpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
    form.append("model", GROQ_MODEL);
    headers = {
      Authorization: `Bearer ${apiKey}`
    };
  } else {
    throw new Error(`STT_PROVIDER no soportado: ${STT_PROVIDER}`);
  }

  if (LANGUAGE) {
    form.append("language", LANGUAGE);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: form
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error ${response.status} transcribiendo ${relativePath}: ${errorBody}`);
  }

  const payload = await response.json();
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.transcript === "string"
        ? payload.transcript
        : typeof payload.output_text === "string"
          ? payload.output_text
          : "";

  if (!text.trim()) {
    throw new Error(`Respuesta sin texto para ${relativePath}: ${JSON.stringify(payload)}`);
  }

  return text.trim();
}

async function persistSceneDefinition(sceneDefinition, transcriptsByPath) {
  const set4Files = getSet4Files(sceneDefinition);

  for (const fileDef of set4Files) {
    if (!fileDef || typeof fileDef.path !== "string") {
      continue;
    }

    const relativePath = fileDef.path.trim();
    const transcript = transcriptsByPath[relativePath];
    if (typeof transcript === "string" && transcript.trim()) {
      fileDef.text = transcript.trim();
    }
  }

  const serialized = `${JSON.stringify(sceneDefinition, null, 2)}\n`;
  await fs.writeFile(SCENE_DEFINITION_FILE, serialized, "utf8");
  return serialized;
}

async function main() {
  await loadEnvFile();

  const apiKey =
    STT_PROVIDER === "openrouter"
      ? process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY
      : STT_PROVIDER === "openai"
        ? process.env.OPENAI_API_KEY
        : STT_PROVIDER === "groq"
          ? process.env.GROQ_API_KEY
          : "";

  if (!apiKey) {
    throw new Error(
      STT_PROVIDER === "openrouter"
        ? "Falta OPENROUTER_API_KEY o OPEN_ROUTER_API_KEY en variables de entorno"
        : STT_PROVIDER === "openai"
          ? "Falta OPENAI_API_KEY en variables de entorno"
          : STT_PROVIDER === "groq"
            ? "Falta GROQ_API_KEY en variables de entorno"
            : `Proveedor no soportado: ${STT_PROVIDER}`
    );
  }

  const sceneDefinition = await loadSceneDefinition();
  const set4Files = getSet4Files(sceneDefinition);
  const paths = set4Files
    .map((entry) => (entry && typeof entry.path === "string" ? entry.path.trim() : ""))
    .filter(Boolean);

  if (!paths.length) {
    throw new Error("No se encontraron archivos en audioSetLibrary.set4.files");
  }

  const existingTranscriptsByPath = {};
  for (const entry of set4Files) {
    if (!entry || typeof entry.path !== "string") {
      continue;
    }

    const relativePath = entry.path.trim();
    if (typeof entry.text === "string" && entry.text.trim() && !existingTranscriptsByPath[relativePath]) {
      existingTranscriptsByPath[relativePath] = entry.text.trim();
    }
  }

  const cache = await loadCache();
  const transcriptsByPath = { ...existingTranscriptsByPath };

  for (const [audioPath, transcript] of Object.entries(cache)) {
    if (typeof transcript === "string" && transcript.trim() && paths.includes(audioPath)) {
      transcriptsByPath[audioPath] = transcript.trim();
    }
  }

  await persistSceneDefinition(sceneDefinition, transcriptsByPath);

  const selectedPaths = onlyPath ? paths.filter((p) => p === onlyPath) : paths;
  if (onlyPath && selectedPaths.length === 0) {
    throw new Error(`El archivo indicado con --only no existe en audioSetLibrary.set4.files: ${onlyPath}`);
  }

  for (const relativePath of selectedPaths) {
    const absoluteFilePath = path.join(__dirname, relativePath);

    try {
      await fs.access(absoluteFilePath);
    } catch {
      console.warn(`Aviso: no existe ${relativePath}, se omite`);
      continue;
    }

    if (!force && typeof existingTranscriptsByPath[relativePath] === "string" && existingTranscriptsByPath[relativePath].trim()) {
      console.log(`Set existente: ${relativePath}`);
      continue;
    }

    if (!force && typeof cache[relativePath] === "string" && cache[relativePath].trim()) {
      console.log(`Cache: ${relativePath}`);
      continue;
    }

    console.log(`Transcribiendo: ${relativePath}`);
    const transcript = await transcribeFile({ absoluteFilePath, relativePath, apiKey });
    cache[relativePath] = transcript;
    transcriptsByPath[relativePath] = transcript;
    await saveCache(cache);
    await persistSceneDefinition(sceneDefinition, transcriptsByPath);
    console.log(`Guardado incremental: ${relativePath}`);

    if (REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const updatedSource = `${JSON.stringify(sceneDefinition, null, 2)}\n`;

  if (dryRun) {
    const previewPath = path.join(__dirname, "scene.definition.preview.json");
    await fs.writeFile(previewPath, updatedSource, "utf8");
    console.log(`Dry run listo: ${previewPath}`);
    return;
  }

  await fs.writeFile(SCENE_DEFINITION_FILE, updatedSource, "utf8");
  console.log("Listo: set4 en scene.definition.json actualizado con textos");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

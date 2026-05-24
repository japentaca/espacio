#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCENE_DEFINITION_FILE = path.join(__dirname, "..", "scene.definition.json");

const args = new Set(process.argv.slice(2));
const setArg = process.argv.find((arg) => arg.startsWith("--set="));
const precisionArg = process.argv.find((arg) => arg.startsWith("--precision="));
const ffprobeArg = process.argv.find((arg) => arg.startsWith("--ffprobe="));
const ffmpegArg = process.argv.find((arg) => arg.startsWith("--ffmpeg="));

const selectedSetName = setArg ? setArg.slice("--set=".length).trim() : "";
const write = args.has("--write");
const precision = Number.parseInt(precisionArg ? precisionArg.slice("--precision=".length) : "3", 10);
const ffprobeBin = ffprobeArg
  ? ffprobeArg.slice("--ffprobe=".length).trim()
  : (process.env.FFPROBE_BIN || "ffprobe");
const ffmpegBin = ffmpegArg
  ? ffmpegArg.slice("--ffmpeg=".length).trim()
  : (process.env.FFMPEG_BIN || "ffmpeg");

async function loadSceneDefinition() {
  const raw = await fs.readFile(SCENE_DEFINITION_FILE, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("scene.definition.json no contiene un objeto valido");
  }

  if (!parsed.audioSetLibrary || typeof parsed.audioSetLibrary !== "object") {
    throw new Error("scene.definition.json no contiene audioSetLibrary");
  }

  return parsed;
}

function clampPrecision(value) {
  if (!Number.isInteger(value)) {
    return 3;
  }

  return Math.min(Math.max(value, 0), 6);
}

function roundDuration(seconds) {
  return Number(seconds.toFixed(clampPrecision(precision)));
}

function parseDurationClock(text) {
  const match = text.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
  if (!match) {
    return null;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseFloat(match[3]);
  const total = (hours * 3600) + (minutes * 60) + seconds;

  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  return total;
}

function probeDurationSeconds(absoluteAudioPath) {
  try {
    const output = execFileSync(
      ffprobeBin,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        absoluteAudioPath
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();

    const duration = Number.parseFloat(output);
    if (Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  } catch {
    // Fallback below.
  }

  const probe = spawnSync(
    ffmpegBin,
    ["-i", absoluteAudioPath, "-f", "null", "-"],
    { encoding: "utf8" }
  );

  if (probe.error) {
    throw new Error(`No se pudo ejecutar ffprobe (${ffprobeBin}) ni ffmpeg (${ffmpegBin})`);
  }

  const clockDuration = parseDurationClock(`${probe.stdout || ""}\n${probe.stderr || ""}`);
  if (clockDuration !== null) {
    return clockDuration;
  }

  throw new Error(`No se pudo extraer duracion para ${absoluteAudioPath} con ffprobe/ffmpeg`);
}

function collectAudioEntries(audioSetLibrary) {
  const setNames = selectedSetName ? [selectedSetName] : Object.keys(audioSetLibrary);
  const entries = [];

  for (const setName of setNames) {
    const setDef = audioSetLibrary[setName];
    if (!setDef) {
      throw new Error(`No existe el set '${setName}' en scene.definition.json`);
    }

    if (!Array.isArray(setDef.files)) {
      continue;
    }

    for (const fileDef of setDef.files) {
      if (!fileDef || typeof fileDef.path !== "string" || !fileDef.path.trim()) {
        continue;
      }

      const relativePath = fileDef.path.trim();
      entries.push({
        setName,
        relativePath,
        absolutePath: path.join(__dirname, relativePath)
      });
    }
  }

  return entries;
}

function injectDurations(sceneDefinition, targetPaths, durationByPath) {
  const library = sceneDefinition.audioSetLibrary;
  const setNames = selectedSetName ? [selectedSetName] : Object.keys(library);
  let touched = 0;

  for (const setName of setNames) {
    const setDef = library[setName];
    if (!setDef || !Array.isArray(setDef.files)) {
      continue;
    }

    for (const fileDef of setDef.files) {
      if (!fileDef || typeof fileDef.path !== "string") {
        continue;
      }

      const relativePath = fileDef.path.trim();
      if (!targetPaths.has(relativePath) || !durationByPath.has(relativePath)) {
        continue;
      }

      const durationSec = roundDuration(durationByPath.get(relativePath));
      if (fileDef.durationSec !== durationSec) {
        fileDef.durationSec = durationSec;
        touched += 1;
      }
    }
  }

  return touched;
}

async function main() {
  console.log(`Usando ffprobe: ${ffprobeBin}`);
  console.log(`Usando ffmpeg : ${ffmpegBin}`);

  const sceneDefinition = await loadSceneDefinition();
  const entries = collectAudioEntries(sceneDefinition.audioSetLibrary);

  if (entries.length === 0) {
    throw new Error("No se encontraron archivos de audio para procesar");
  }

  const uniquePaths = [...new Set(entries.map((entry) => entry.relativePath))];
  const durationByPath = new Map();

  for (const relativePath of uniquePaths) {
    const absolutePath = path.join(__dirname, relativePath);
    try {
      await fs.access(absolutePath);
    } catch {
      console.warn(`Aviso: no existe ${relativePath}, se omite`);
      continue;
    }

    const seconds = probeDurationSeconds(absolutePath);
    durationByPath.set(relativePath, seconds);
    console.log(`Duracion ${relativePath}: ${roundDuration(seconds)}s`);
  }

  const targetPaths = new Set(uniquePaths);
  const touched = injectDurations(sceneDefinition, targetPaths, durationByPath);

  if (touched === 0) {
    console.log("Sin cambios: no se actualizo durationSec en ningun item");
    return;
  }

  const serialized = `${JSON.stringify(sceneDefinition, null, 2)}\n`;

  if (write) {
    await fs.writeFile(SCENE_DEFINITION_FILE, serialized, "utf8");
    console.log(`Listo: scene.definition.json actualizado (${touched} items)`);
  } else {
    const previewFile = path.join(__dirname, "scene.definition.durations.preview.json");
    await fs.writeFile(previewFile, serialized, "utf8");
    console.log(`Preview generado: ${previewFile}`);
    console.log("Para aplicar cambios ejecuta: node espacio/audio/annotate-durations.mjs --write");
  }
}

main().catch((error) => {
  if (error && error.message && /(ffprobe|ffmpeg)/i.test(error.message)) {
    console.error("No se pudo ejecutar ffprobe/ffmpeg. Define rutas con --ffprobe y --ffmpeg o usa FFPROBE_BIN y FFMPEG_BIN.");
    console.error(error.message);
  } else {
    console.error(error.message || error);
  }
  process.exitCode = 1;
});

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
const thresholdArg = process.argv.find((arg) => arg.startsWith("--threshold-db="));
const minSilenceArg = process.argv.find((arg) => arg.startsWith("--min-silence="));
const minTrimArg = process.argv.find((arg) => arg.startsWith("--min-trim="));
const ffprobeArg = process.argv.find((arg) => arg.startsWith("--ffprobe="));
const ffmpegArg = process.argv.find((arg) => arg.startsWith("--ffmpeg="));
const setArg = process.argv.find((arg) => arg.startsWith("--set="));

const setName = setArg ? setArg.slice("--set=".length).trim() : "set4";
const write = args.has("--write");
const showHelp = args.has("--help") || args.has("-h");

const thresholdDb = Number.parseFloat(thresholdArg ? thresholdArg.slice("--threshold-db=".length) : "-40");
const minSilenceSec = Number.parseFloat(minSilenceArg ? minSilenceArg.slice("--min-silence=".length) : "0.2");
const minTrimSec = Number.parseFloat(minTrimArg ? minTrimArg.slice("--min-trim=".length) : "0.08");

const ffprobeArgValue = ffprobeArg ? ffprobeArg.slice("--ffprobe=".length).trim() : "";
const ffmpegArgValue = ffmpegArg ? ffmpegArg.slice("--ffmpeg=".length).trim() : "";

let ffprobeBin = "ffprobe";
let ffmpegBin = "ffmpeg";

async function loadEnvFile() {
  const envPath = path.resolve(__dirname, "..", ".env");

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

function resolveBinary(cliValue, envBinary, envBinDir, fallbackName) {
  if (cliValue) {
    return cliValue;
  }

  if (envBinary && envBinary.trim()) {
    return envBinary.trim();
  }

  if (envBinDir && envBinDir.trim()) {
    return path.join(envBinDir.trim(), process.platform === "win32" ? `${fallbackName}.exe` : fallbackName);
  }

  return fallbackName;
}

function printHelp() {
  console.log("Uso:");
  console.log("  node audio/trim-set4-trailing-silence.mjs [opciones]");
  console.log("");
  console.log("Opciones:");
  console.log("  --set=<nombre>          Set de audio a procesar (default: set4)");
  console.log("  --threshold-db=<dB>     Umbral de silencio en dB (default: -40)");
  console.log("  --min-silence=<seg>     Duracion minima para detectar silencio (default: 0.2)");
  console.log("  --min-trim=<seg>        Silencio minimo para recortar (default: 0.08)");
  console.log("  --write                 Aplica recortes sobre archivos originales");
  console.log("  --ffprobe=<ruta>        Ruta/binario de ffprobe");
  console.log("  --ffmpeg=<ruta>         Ruta/binario de ffmpeg");
  console.log("  -h, --help              Muestra esta ayuda");
  console.log("");
  console.log("Notas:");
  console.log("  - Sin --write corre en dry-run (solo reporte, sin cambios)");
  console.log("  - Soporta .env raiz con FFMPEG_BIN_DIR, FFMPEG_BIN y FFPROBE_BIN");
  console.log("  - Para actualizar durationSec luego de recortar, ejecuta annotate-durations.mjs");
}

function ensureNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function round(value, precision = 3) {
  return Number(value.toFixed(precision));
}

async function loadSceneDefinition() {
  const raw = await fs.readFile(SCENE_DEFINITION_FILE, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("scene.definition.json no contiene un objeto valido");
  }

  if (!parsed.audioSetLibrary || typeof parsed.audioSetLibrary !== "object") {
    throw new Error("scene.definition.json no contiene audioSetLibrary");
  }

  const setDef = parsed.audioSetLibrary[setName];
  if (!setDef || !Array.isArray(setDef.files)) {
    throw new Error(`No existe audioSetLibrary.${setName}.files en scene.definition.json`);
  }

  return parsed;
}

function getTargetFiles(sceneDefinition) {
  const files = sceneDefinition.audioSetLibrary[setName].files;
  const uniquePaths = new Set();

  for (const fileDef of files) {
    if (!fileDef || typeof fileDef.path !== "string") {
      continue;
    }

    const relativePath = fileDef.path.trim();
    if (relativePath) {
      uniquePaths.add(relativePath);
    }
  }

  return [...uniquePaths].sort((a, b) => a.localeCompare(b));
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

  const durationMatch = `${probe.stdout || ""}\n${probe.stderr || ""}`.match(
    /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i
  );

  if (!durationMatch) {
    throw new Error(`No se pudo obtener duracion para ${absoluteAudioPath}`);
  }

  const hours = Number.parseInt(durationMatch[1], 10);
  const minutes = Number.parseInt(durationMatch[2], 10);
  const seconds = Number.parseFloat(durationMatch[3]);
  const total = (hours * 3600) + (minutes * 60) + seconds;

  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`Duracion invalida para ${absoluteAudioPath}`);
  }

  return total;
}

function detectTrailingSilenceSeconds(absoluteAudioPath, totalDurationSec, noiseThresholdDb, minSilenceDurationSec) {
  const detector = spawnSync(
    ffmpegBin,
    [
      "-hide_banner",
      "-i",
      absoluteAudioPath,
      "-af",
      `silencedetect=noise=${noiseThresholdDb}dB:d=${minSilenceDurationSec}`,
      "-f",
      "null",
      "-"
    ],
    { encoding: "utf8" }
  );

  if (detector.error) {
    throw new Error(`No se pudo ejecutar ffmpeg (${ffmpegBin}) para detectar silencio`);
  }

  const output = `${detector.stdout || ""}\n${detector.stderr || ""}`;
  const lines = output.split(/\r?\n/);

  let currentSilenceStart = null;
  let lastClosedSilence = null;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (startMatch) {
      currentSilenceStart = Number.parseFloat(startMatch[1]);
      continue;
    }

    const endMatch = line.match(
      /silence_end:\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*silence_duration:\s*([0-9]+(?:\.[0-9]+)?)/i
    );

    if (endMatch && currentSilenceStart !== null) {
      const end = Number.parseFloat(endMatch[1]);
      lastClosedSilence = {
        start: currentSilenceStart,
        end
      };
      currentSilenceStart = null;
    }
  }

  let trailingStart = null;
  const eofToleranceSec = 0.12;

  if (currentSilenceStart !== null) {
    trailingStart = currentSilenceStart;
  } else if (
    lastClosedSilence
    && Number.isFinite(lastClosedSilence.end)
    && (totalDurationSec - lastClosedSilence.end) <= eofToleranceSec
  ) {
    trailingStart = lastClosedSilence.start;
  }

  if (!Number.isFinite(trailingStart) || trailingStart === null) {
    return 0;
  }

  const trailing = Math.max(0, totalDurationSec - trailingStart);
  return Number.isFinite(trailing) ? trailing : 0;
}

function createTempPath(absoluteAudioPath) {
  const parsed = path.parse(absoluteAudioPath);
  return path.join(
    parsed.dir,
    `${parsed.name}.trimtmp-${Date.now()}-${process.pid}${parsed.ext}`
  );
}

function trimAudioFile(absoluteAudioPath, newDurationSec) {
  const tempPath = createTempPath(absoluteAudioPath);
  const safeDuration = Math.max(0, newDurationSec);

  const trim = spawnSync(
    ffmpegBin,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      absoluteAudioPath,
      "-t",
      safeDuration.toFixed(6),
      "-map",
      "0:a:0",
      "-c",
      "copy",
      tempPath
    ],
    { encoding: "utf8" }
  );

  if (trim.error || trim.status !== 0) {
    throw new Error(`ffmpeg fallo al recortar ${absoluteAudioPath}: ${(trim.stderr || "").trim()}`);
  }

  return fs.rename(tempPath, absoluteAudioPath).catch(async (error) => {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore cleanup error
    }
    throw error;
  });
}

async function main() {
  if (showHelp) {
    printHelp();
    return;
  }

  await loadEnvFile();

  ffprobeBin = resolveBinary(
    ffprobeArgValue,
    process.env.FFPROBE_BIN,
    process.env.FFMPEG_BIN_DIR,
    "ffprobe"
  );
  ffmpegBin = resolveBinary(
    ffmpegArgValue,
    process.env.FFMPEG_BIN,
    process.env.FFMPEG_BIN_DIR,
    "ffmpeg"
  );

  const normalizedThresholdDb = ensureNumber(thresholdDb, -40);
  const normalizedMinSilenceSec = Math.max(0.05, ensureNumber(minSilenceSec, 0.2));
  const normalizedMinTrimSec = Math.max(0, ensureNumber(minTrimSec, 0.08));

  console.log(`Set objetivo        : ${setName}`);
  console.log(`Modo               : ${write ? "WRITE" : "DRY-RUN"}`);
  console.log(`Umbral silencio    : ${normalizedThresholdDb} dB`);
  console.log(`Min silencio detect: ${normalizedMinSilenceSec}s`);
  console.log(`Min silencio recort: ${normalizedMinTrimSec}s`);
  console.log(`ffprobe            : ${ffprobeBin}`);
  console.log(`ffmpeg             : ${ffmpegBin}`);

  const sceneDefinition = await loadSceneDefinition();
  const relativePaths = getTargetFiles(sceneDefinition);

  if (relativePaths.length === 0) {
    console.log("No hay archivos para procesar");
    return;
  }

  let scanned = 0;
  let candidates = 0;
  let trimmed = 0;
  let totalSilenceSec = 0;

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(__dirname, relativePath);

    try {
      await fs.access(absolutePath);
    } catch {
      console.warn(`Aviso: no existe ${relativePath}, se omite`);
      continue;
    }

    scanned += 1;

    const durationSec = probeDurationSeconds(absolutePath);
    const trailingSilenceSec = detectTrailingSilenceSeconds(
      absolutePath,
      durationSec,
      normalizedThresholdDb,
      normalizedMinSilenceSec
    );
    const shouldTrim = trailingSilenceSec >= normalizedMinTrimSec;
    const targetDurationSec = Math.max(0.03, durationSec - trailingSilenceSec);

    if (shouldTrim) {
      candidates += 1;
      totalSilenceSec += trailingSilenceSec;
    }

    console.log(
      `${relativePath} | dur=${round(durationSec)}s | cola=${round(trailingSilenceSec)}s | ${shouldTrim ? "RECORTAR" : "ok"}`
    );

    if (write && shouldTrim) {
      await trimAudioFile(absolutePath, targetDurationSec);
      trimmed += 1;
    }
  }

  console.log("-");
  console.log(`Procesados            : ${scanned}`);
  console.log(`Con cola detectable   : ${candidates}`);
  console.log(`Silencio total detect : ${round(totalSilenceSec)}s`);

  if (write) {
    console.log(`Archivos recortados   : ${trimmed}`);
    console.log("Siguiente paso sugerido: ejecutar annotate-durations.mjs para refrescar durationSec");
  } else {
    console.log("Dry-run completado. Para aplicar recortes agrega --write");
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
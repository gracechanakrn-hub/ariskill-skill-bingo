// Loads `.env` (repo root) for the AI tooling only. Uses Node's built-in loader (no dotenv dependency).
// Never import this from the game service or any app: keys stay on the developer machine.
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnv() {
  const file = resolve(ROOT, '.env');
  if (existsSync(file)) { try { process.loadEnvFile(file); } catch (e) { console.warn(`.env not loaded: ${e.message}`); } }
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    GEMINI_IMAGE_MODEL: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
    OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL || 'gpt-5.1',
    OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    BLENDER_BIN: process.env.BLENDER_BIN || '/Applications/Blender.app/Contents/MacOS/Blender',
  };
}

/** Throws a clear, key-free message when a provider key is missing. */
export function requireKey(env, name) {
  if (!env[name]) throw new Error(`${name} is empty. Put it in .env (see .env.example) and rerun.`);
  return env[name];
}

/** Redacts anything that looks like a key before logging. */
export function redact(text) { return String(text).replace(/(sk-|AIza)[A-Za-z0-9_\-]{8,}/g, '$1********'); }

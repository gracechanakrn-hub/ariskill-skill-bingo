#!/usr/bin/env python3
"""build-audio.py - deterministic synthesis of every AriSkill Skill Bingo audio cue.

Reads   assets-src/audio/cues.json            (editable synthesis recipes + integration policy)
Writes  assets/audio/<cue>.wav                 (22 050 Hz, 16-bit PCM, mono)
        assets/manifest/audio.yaml             (canonical manifest, workflow section 5.2 fields)
        assets/manifest/audio.json             (same content, fetched by packages/ui/audio.js)

Dependencies: Python 3 standard library + numpy only (docs/stack-verification.md).
Determinism: fixed numpy RNG seed per cue, float64 math, no timestamps in outputs.
Running the script twice yields byte-identical WAVs and manifests (decision D-14).

Usage: python3 tools/assets/build-audio.py [--check]
  --check  re-synthesise in memory and fail (exit 1) if any output on disk differs.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets-src" / "audio" / "cues.json"
OUT_DIR = ROOT / "assets" / "audio"
MANIFEST_YAML = ROOT / "assets" / "manifest" / "audio.yaml"
MANIFEST_JSON = ROOT / "assets" / "manifest" / "audio.json"
GENERATOR = "tools/assets/build-audio.py"
GENERATOR_VERSION = "1.0.0"
LICENSE = "internal-original"

NOTE_INDEX = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


# ----------------------------------------------------------------------------- helpers
def note_to_hz(name: str | float | int) -> float:
    """Scientific pitch name (A4 = 440 Hz) or a literal frequency."""
    if isinstance(name, (int, float)):
        return float(name)
    s = name.strip()
    letter = s[0].upper()
    rest = s[1:]
    semis = NOTE_INDEX[letter]
    while rest and rest[0] in "#b":
        semis += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    octave = int(rest)
    midi = 12 * (octave + 1) + semis
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def db_to_lin(db: float) -> float:
    return 10.0 ** (db / 20.0)


def lin_to_db(x: float) -> float:
    return -120.0 if x <= 0 else 20.0 * math.log10(x)


def adsr(sr: int, gate_s: float, env: dict) -> np.ndarray:
    """Linear attack, exponential decay to sustain, hold, exponential+linear release to exact zero."""
    a = max(float(env.get("a", 0.005)), 1e-4)
    d = max(float(env.get("d", 0.05)), 1e-4)
    s = float(env.get("s", 0.0))
    r = max(float(env.get("r", 0.05)), 1e-4)
    curve = float(env.get("curve", 5.0))
    n = int(round((gate_s + r) * sr))
    t = np.arange(n) / sr
    out = np.zeros(n)
    att = t < a
    out[att] = t[att] / a
    dec = (t >= a) & (t < gate_s)
    out[dec] = s + (1.0 - s) * np.exp(-(t[dec] - a) * curve / d)
    level_at_gate = s + (1.0 - s) * math.exp(-max(gate_s - a, 0.0) * curve / d) if gate_s > a else min(gate_s / a, 1.0)
    rel = t >= gate_s
    x = (t[rel] - gate_s) / r
    out[rel] = level_at_gate * np.exp(-x * curve) * np.clip(1.0 - x, 0.0, 1.0)
    return out


def bandlimited(phase: np.ndarray, fmax: float, sr: int, wave_name: str, partials) -> np.ndarray:
    """Additive, band-limited waveforms so nothing aliases at 22 050 Hz."""
    nyq_limit = 0.45 * sr
    if wave_name == "sine":
        return np.sin(2 * np.pi * phase)
    if wave_name == "partials":
        acc = np.zeros_like(phase)
        for ratio, amp in partials:
            if fmax * ratio < nyq_limit:
                acc += amp * np.sin(2 * np.pi * ratio * phase)
        return acc
    kmax = max(1, int(nyq_limit / max(fmax, 1.0)))
    acc = np.zeros_like(phase)
    if wave_name == "saw":
        for k in range(1, kmax + 1):
            acc += np.sin(2 * np.pi * k * phase) / k
        return acc * (2.0 / np.pi)
    if wave_name == "square":
        for k in range(1, kmax + 1, 2):
            acc += np.sin(2 * np.pi * k * phase) / k
        return acc * (4.0 / np.pi)
    if wave_name == "triangle":
        sign = 1.0
        for k in range(1, kmax + 1, 2):
            acc += sign * np.sin(2 * np.pi * k * phase) / (k * k)
            sign = -sign
        return acc * (8.0 / (np.pi ** 2))
    raise ValueError(f"unknown wave {wave_name}")


def onepole_lowpass(x: np.ndarray, sr: int, cutoff) -> np.ndarray:
    """Two cascaded one-pole low-pass stages; cutoff may be a scalar or a per-sample array (sweeps)."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    coef = 1.0 - np.exp(-2.0 * np.pi * np.clip(c, 10.0, sr * 0.45) / sr)
    y = x
    for _ in range(2):
        out = np.empty_like(y)
        acc = 0.0
        for i in range(len(y)):
            acc += coef[i] * (y[i] - acc)
            out[i] = acc
        y = out
    return y


def onepole_highpass(x: np.ndarray, sr: int, cutoff: float) -> np.ndarray:
    return x - onepole_lowpass(x, sr, cutoff)


def fft_shape(x: np.ndarray, sr: int, lo: float | None, hi: float | None, order: float = 2.0) -> np.ndarray:
    """Circular (FFT) filtering: keeps a loop exactly periodic, so the seam stays continuous."""
    n = len(x)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1.0 / sr)
    gain = np.ones_like(f)
    with np.errstate(divide="ignore", invalid="ignore"):
        if hi:
            above = f > hi
            gain[above] *= (hi / f[above]) ** order
        if lo:
            below = (f < lo)
            gain[below] *= np.where(f[below] > 0, (f[below] / lo) ** order, 0.0)
    return np.fft.irfft(spec * gain, n=n)


# ----------------------------------------------------------------------------- synthesis
def render_voice(v: dict, sr: int, rng: np.random.Generator) -> tuple[int, np.ndarray]:
    gate_s = float(v.get("gate_s", 0.1))
    env = adsr(sr, gate_s, v.get("env", {}))
    n = len(env)
    t = np.arange(n) / sr
    wave_name = v.get("wave", "sine")
    if wave_name == "noise":
        sig = rng.standard_normal(n)
    else:
        f0 = note_to_hz(v.get("note", v.get("freq", "A4")))
        f1 = note_to_hz(v["glide_to"]) if v.get("glide_to") is not None else f0
        if f1 != f0 and n > 1:
            freq = f0 * (f1 / f0) ** (t / t[-1])
        else:
            freq = np.full(n, f0)
        vib = v.get("vibrato")
        if vib:
            freq = freq * 2.0 ** (float(vib.get("cents", 0)) / 1200.0 * np.sin(2 * np.pi * float(vib.get("hz", 5)) * t))
        phase = np.cumsum(freq) / sr
        sig = bandlimited(phase, float(np.max(freq)), sr, wave_name, v.get("partials", [[1, 1.0]]))
    hp = v.get("highpass_hz")
    if hp:
        sig = onepole_highpass(sig, sr, float(hp))
    lp = v.get("lowpass_hz")
    if lp is not None:
        if isinstance(lp, (list, tuple)):
            lo, hi = float(lp[0]), float(lp[1])
            span = max(gate_s, 1e-3)
            cutoff = lo * (hi / lo) ** np.clip(t / span, 0.0, 1.0)
        else:
            cutoff = float(lp)
        sig = onepole_lowpass(sig, sr, cutoff)
    if wave_name == "noise":
        sig = sig / max(float(np.sqrt(np.mean(sig ** 2))), 1e-9) * 0.35
    sig = sig * env * float(v.get("gain", 1.0))
    start = int(round(float(v.get("start_s", 0.0)) * sr))
    return start, sig


def render_oneshot(cue: dict, sr: int, rng: np.random.Generator) -> np.ndarray:
    n = int(round(float(cue["duration_s"]) * sr))
    mix = np.zeros(n)
    for v in cue["voices"]:
        start, sig = render_voice(v, sr, rng)
        end = min(n, start + len(sig))
        if end > start:
            mix[start:end] += sig[: end - start]
    return mix


def render_loop(cue: dict, sr: int, rng: np.random.Generator) -> np.ndarray:
    """Exact-period synthesis: every frequency is an integer number of cycles per loop."""
    length_s = float(cue["duration_s"])
    n = int(round(length_s * sr))
    t = np.arange(n) / sr
    q = lambda hz: round(hz * length_s) / length_s  # quantise to k / L Hz
    mix = np.zeros(n)
    for layer in cue["layers"]:
        kind = layer["type"]
        if kind == "pad":
            gains = layer.get("gains", [1.0] * len(layer["notes"]))
            lfo_cycles = layer.get("lfo_cycles", [1] * len(layer["notes"]))
            depth = float(layer.get("lfo_depth", 0.5))
            detune_cycles = int(layer.get("detune_cycles", 0))
            for note, g, cyc in zip(layer["notes"], gains, lfo_cycles):
                base = q(note_to_hz(note))
                lfo_phase = rng.uniform(0, 1)
                lfo = (1.0 - depth) + depth * 0.5 * (1.0 + np.sin(2 * np.pi * (int(cyc) * t / length_s + lfo_phase)))
                voice = np.zeros(n)
                offsets = [0] if detune_cycles == 0 else [-detune_cycles, detune_cycles]
                for off in offsets:
                    f = base + off / length_s
                    ph0 = rng.uniform(0, 1)
                    for ratio, amp in layer.get("partials", [[1, 1.0]]):
                        fk = f * ratio
                        if fk < 0.45 * sr:
                            voice += amp * np.sin(2 * np.pi * (fk * t + ph0))
                mix += voice * lfo * float(g) / len(offsets)
        elif kind == "noise":
            lo, hi = layer.get("band_hz", [100, 2000])
            noise = rng.standard_normal(n)
            noise = fft_shape(noise, sr, float(lo), float(hi), order=2.0)
            noise = noise / max(float(np.sqrt(np.mean(noise ** 2))), 1e-9)
            depth = float(layer.get("lfo_depth", 0.5))
            cyc = int(layer.get("lfo_cycles", 1))
            lfo_phase = rng.uniform(0, 1)
            lfo = (1.0 - depth) + depth * 0.5 * (1.0 + np.sin(2 * np.pi * (cyc * t / length_s + lfo_phase)))
            mix += noise * lfo * float(layer.get("gain", 0.1))
        else:
            raise ValueError(f"unknown loop layer type {kind}")
    if cue.get("lowpass_hz"):
        mix = fft_shape(mix, sr, None, float(cue["lowpass_hz"]), order=2.0)
    return mix


# ----------------------------------------------------------------------------- mastering
def soft_limit(x: np.ndarray, threshold: float, ceiling: float) -> np.ndarray:
    ax = np.abs(x)
    over = ax > threshold
    y = x.copy()
    y[over] = np.sign(x[over]) * (threshold + (ceiling - threshold) * np.tanh((ax[over] - threshold) / (ceiling - threshold)))
    return y


def master(x: np.ndarray, sr: int, target_rms_db: float, ceiling_db: float, threshold_db: float, fade_ms: float, is_loop: bool) -> tuple[np.ndarray, dict]:
    rms = float(np.sqrt(np.mean(x ** 2)))
    gain_rms = db_to_lin(target_rms_db) / max(rms, 1e-9)
    peak = float(np.max(np.abs(x)))
    gain_peak = 1.0 / max(peak, 1e-9)  # never push raw peaks above 0 dBFS; the limiter handles the last 4 dB
    gain = min(gain_rms, gain_peak)
    y = x * gain
    pre_peak = float(np.max(np.abs(y)))
    y = soft_limit(y, db_to_lin(threshold_db), db_to_lin(ceiling_db))
    limited_peak = float(np.max(np.abs(y)))
    if not is_loop:
        nf = int(round(fade_ms / 1000.0 * sr))
        if nf > 0 and len(y) > 2 * nf:
            ramp = np.linspace(0.0, 1.0, nf, endpoint=False)
            y[:nf] *= ramp
            y[-nf:] *= ramp[::-1]
    y = np.clip(y, -1.0, 1.0)
    stats = {
        "limiter_gain_reduction_db": round(max(0.0, lin_to_db(pre_peak) - lin_to_db(limited_peak)), 2) if pre_peak > db_to_lin(threshold_db) else 0.0,
        "normalisation_mode": "rms" if gain == gain_rms else "peak",
    }
    return y, stats


def to_pcm16(y: np.ndarray) -> np.ndarray:
    return np.clip(np.round(y * 32767.0), -32768, 32767).astype("<i2")


def wav_bytes(pcm: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# ----------------------------------------------------------------------------- manifest
def yaml_scalar(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v) if isinstance(v, float) else str(v)
    s = str(v)
    return json.dumps(s, ensure_ascii=False)


def to_yaml(obj, indent: int = 0) -> str:
    pad = "  " * indent
    lines = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, dict) and v:
                lines.append(f"{pad}{k}:")
                lines.append(to_yaml(v, indent + 1))
            elif isinstance(v, list) and v and any(isinstance(i, (dict, list)) for i in v):
                lines.append(f"{pad}{k}:")
                for item in v:
                    if isinstance(item, dict):
                        body = to_yaml(item, indent + 2).split("\n")
                        first = body[0].lstrip()
                        lines.append(f"{pad}  - {first}")
                        lines.extend(body[1:])
                    else:
                        lines.append(f"{pad}  - {yaml_scalar(item)}")
            elif isinstance(v, list):
                lines.append(f"{pad}{k}: [{', '.join(yaml_scalar(i) for i in v)}]")
            elif isinstance(v, dict):
                lines.append(f"{pad}{k}: {{}}")
            else:
                lines.append(f"{pad}{k}: {yaml_scalar(v)}")
    return "\n".join(lines)


def build(write: bool = True) -> tuple[dict, dict[str, bytes]]:
    spec = json.loads(SRC.read_text(encoding="utf-8"))
    sr = int(spec["sample_rate"])
    defaults = spec["defaults"]
    base_seed = int(spec["seed"])
    entries = []
    files: dict[str, bytes] = {}
    total_bytes = 0
    for index, (cue_id, cue) in enumerate(spec["cues"].items()):
        rng = np.random.default_rng([base_seed, index])
        is_loop = cue.get("kind") == "loop"
        raw = render_loop(cue, sr, rng) if is_loop else render_oneshot(cue, sr, rng)
        target = float(cue.get("target_rms_dbfs", defaults["loop_rms_dbfs"] if is_loop else defaults["oneshot_rms_dbfs"]))
        y, stats = master(raw, sr, target, float(defaults["ceiling_dbfs"]), float(defaults["limiter_threshold_dbfs"]), float(defaults["fade_ms"]), is_loop)
        pcm = to_pcm16(y)
        data = wav_bytes(pcm, sr)
        fs = pcm.astype(np.float64) / 32768.0
        peak_db = round(lin_to_db(float(np.max(np.abs(fs)))), 2)
        rms_db = round(lin_to_db(float(np.sqrt(np.mean(fs ** 2)))), 2)
        loop = None
        if is_loop:
            steps = np.abs(np.diff(fs))
            loop = {
                "start_sample": 0,
                "end_sample": int(len(pcm)),
                "seam_step_fs": round(float(abs(fs[0] - fs[-1])), 6),
                "max_internal_step_fs": round(float(np.max(steps)), 6),
                "method": "exact-period synthesis (all partials, detunes and LFOs are integer cycles per loop)",
            }
        runtime_file = f"assets/audio/{cue_id}.wav"
        files[runtime_file] = data
        total_bytes += len(data)
        policy = cue.get("policy", {})
        entries.append({
            "id": cue_id,
            "kind": "audio-loop" if is_loop else "audio-oneshot",
            "source_file": f"assets-src/audio/cues.json#/cues/{cue_id}",
            "source_format": "json-synthesis-recipe",
            "runtime_file": runtime_file,
            "runtime_format": "wav-pcm16-mono-22050",
            "fallback_file": None,
            "fallback_format": "caption-only (silent; caption/visual equivalent carries the information)",
            "version": spec["version"],
            "checksum": "sha256:" + hashlib.sha256(data).hexdigest(),
            "license": LICENSE,
            "generator_script": GENERATOR,
            "generator_version": GENERATOR_VERSION,
            "approved_by": None,
            "description": cue.get("description", ""),
            "duration_s": round(len(pcm) / sr, 4),
            "max_duration_s": cue.get("max_duration_s"),
            "sample_rate": sr,
            "channels": 1,
            "bit_depth": 16,
            "bytes": len(data),
            "peak_dbfs": peak_db,
            "rms_dbfs": rms_db,
            "rms_target_dbfs": target,
            "normalisation": stats["normalisation_mode"],
            "limiter_gain_reduction_db": stats["limiter_gain_reduction_db"],
            "fade_ms": 0 if is_loop else defaults["fade_ms"],
            "loop": loop,
            "event_types": policy.get("event_types", []),
            "audiences": policy.get("audiences", []),
            "priority": policy.get("priority", 1),
            "rate_limit_ms": policy.get("rate_limit_ms", 0),
            "duck": policy.get("duck"),
            "preload": policy.get("preload", []),
            "caption": policy.get("caption", cue_id),
            "copy_key": policy.get("copy_key"),
            "visual_equivalent": policy.get("visual_equivalent", ""),
        })
    manifest = {
        "id": "ariskill-skill-bingo/assets/manifest/audio",
        "version": spec["version"],
        "generator_script": GENERATOR,
        "generator_version": GENERATOR_VERSION,
        "source_file": "assets-src/audio/cues.json",
        "license": LICENSE,
        "provenance": "All cues are synthesised from assets-src/audio/cues.json by tools/assets/build-audio.py (numpy, seeded). No recorded, sampled or third-party material. Decision D-14.",
        "sample_rate": sr,
        "channels": 1,
        "bit_depth": 16,
        "seed": base_seed,
        "budgets": {
            "max_total_bytes": int(defaults["max_total_bytes"]),
            "max_oneshot_bytes": int(defaults["max_oneshot_bytes"]),
            "peak_ceiling_dbfs": float(defaults["ceiling_dbfs"]),
            "oneshot_rms_dbfs": float(defaults["oneshot_rms_dbfs"]),
            "loop_rms_dbfs": float(defaults["loop_rms_dbfs"]),
            "rms_tolerance_db": 3.0,
            "max_concurrent_voices": 4,
        },
        "totals": {"bytes": total_bytes, "cues": len(entries)},
        "cues": entries,
    }
    if write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        MANIFEST_YAML.parent.mkdir(parents=True, exist_ok=True)
        for rel, data in files.items():
            (ROOT / rel).write_bytes(data)
        MANIFEST_JSON.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        MANIFEST_YAML.write_text("# Generated by tools/assets/build-audio.py - do not hand-edit. Canonical audio manifest (audio.json is the same content for the browser).\n" + to_yaml(manifest) + "\n", encoding="utf-8")
    return manifest, files


def main(argv: list[str]) -> int:
    check = "--check" in argv
    manifest, files = build(write=not check)
    if check:
        bad = []
        for rel, data in files.items():
            p = ROOT / rel
            if not p.exists() or p.read_bytes() != data:
                bad.append(rel)
        current = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
        if not MANIFEST_JSON.exists() or MANIFEST_JSON.read_text(encoding="utf-8") != current:
            bad.append(str(MANIFEST_JSON.relative_to(ROOT)))
        if bad:
            print("STALE: " + ", ".join(bad))
            return 1
        print("audio outputs are up to date")
        return 0
    for e in manifest["cues"]:
        loop = e["loop"]
        loop_txt = f" loop seam={loop['seam_step_fs']:.4f} maxstep={loop['max_internal_step_fs']:.4f}" if loop else ""
        print(f"{e['id']:<20} {e['duration_s']:>6.3f}s {e['bytes']:>7d}B peak {e['peak_dbfs']:>6.2f} dBFS rms {e['rms_dbfs']:>6.2f} (target {e['rms_target_dbfs']:.0f}) {e['normalisation']:<4} GR {e['limiter_gain_reduction_db']:.2f} dB{loop_txt}")
    print(f"total {manifest['totals']['bytes']} bytes in {manifest['totals']['cues']} cues -> {MANIFEST_YAML.relative_to(ROOT)}, {MANIFEST_JSON.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Campaign narration: synthesises every advisor line (FR + EN) with Kokoro TTS
(Apache-2.0 model, run locally), then loudness-normalises and encodes MP3.

Setup (local, inside the project):
  python3 -m venv .tools/venv && .tools/venv/bin/pip install kokoro-onnx soundfile
  model files in .cache/tts/ (see README)
Usage: .tools/venv/bin/python scripts/audio/gen-voice.py [--force]
Output: public/voice/<lang>/<key>.mp3
"""
import json
import os
import re
import subprocess
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FFMPEG = os.path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg')
VOICES = {'fr': ('ff_siwis', 'fr-fr', 0.95), 'en': ('af_heart', 'en-us', 0.95)}

# Lines spoken by the advisor (keys of src/ui/i18n/<lang>.json).
MISSIONS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']
TUTORIAL = ['spawn', 'camera', 'expand', 'ratio', 'city', 'attack', 'port', 'alliance', 'tech', 'done']


def lookup(d, key):
    if key in d:
        return d[key]
    head, _, rest = key.partition('.')
    if head in d and isinstance(d[head], dict):
        return lookup(d[head], rest)
    return None


def keys_for(d):
    out = ['tutorial.brief', 'campaign.failed', 'guide.spawn']
    out += [f'tutorial.{k}' for k in TUTORIAL]
    for m in MISSIONS:
        out += [f'campaign.{m}.brief', f'campaign.{m}.outro']
        guide = lookup(d, f'guide.{m}') or {}
        out += [f'guide.{m}.{k}' for k in guide]
    return out


def speakable(text, lang):
    text = text.replace('«', '').replace('»', '').replace('“', '').replace('”', '')
    if lang == 'fr':
        text = re.sub(r'\bMaj\b', 'Majuscule', text)
        text = text.replace('%', ' pour cent')
    else:
        text = text.replace('%', ' percent')
    return text


def main():
    force = '--force' in sys.argv
    k = Kokoro(os.path.join(ROOT, '.cache/tts/kokoro-v1.0.onnx'), os.path.join(ROOT, '.cache/tts/voices-v1.0.bin'))
    for lang, (voice, code, speed) in VOICES.items():
        d = json.load(open(os.path.join(ROOT, 'src/ui/i18n', f'{lang}.json'), encoding='utf8'))
        out_dir = os.path.join(ROOT, 'public/voice', lang)
        os.makedirs(out_dir, exist_ok=True)
        for key in keys_for(d):
            text = lookup(d, key)
            if not isinstance(text, str):
                print(f'  ! {lang} {key}: missing text')
                continue
            dest = os.path.join(out_dir, f'{key}.mp3')
            if os.path.exists(dest) and not force:
                continue
            samples, sr = k.create(speakable(text, lang), voice=voice, speed=speed, lang=code)
            wav = os.path.join(ROOT, '.cache/tts', f'{lang}-{key}.wav')
            sf.write(wav, samples, sr)
            subprocess.run(
                [FFMPEG, '-y', '-loglevel', 'error', '-i', wav, '-af',
                 'highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=7', '-ac', '1', '-ar', '24000',
                 '-c:a', 'libmp3lame', '-b:a', '64k', dest],
                check=True,
            )
            print(f'  ✓ {lang} {key} ({len(samples) / sr:.1f} s)')


if __name__ == '__main__':
    main()

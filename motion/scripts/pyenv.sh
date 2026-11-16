#!/bin/sh
# One shared Python env for every motion-reel project (librosa/numba need Python 3.12; the system 3.14 can't build them).
# Created once at <skill>/.venv (~1 min), then reused: init.sh links each project's .venv to it.
#   sh <skill>/scripts/pyenv.sh        → prints the python path
set -e
SKILL="$(cd "$(dirname "$0")/.." && pwd)"; V="$SKILL/.venv"
if [ ! -x "$V/bin/python" ] || ! "$V/bin/python" -c "import librosa, numpy, scipy, soundfile, PIL, faster_whisper" 2>/dev/null; then
  PY312="$(command -v python3.12 || ls /usr/local/opt/python@3.12/bin/python3.12 /opt/homebrew/opt/python@3.12/bin/python3.12 2>/dev/null | head -1)"
  [ -n "$PY312" ] || { echo "need python 3.12 (brew install python@3.12)"; exit 1; }
  if command -v uv >/dev/null; then
    uv venv -q --python "$PY312" "$V"
    uv pip install -q --python "$V/bin/python" numpy==2.0.2 scipy soundfile librosa==0.10.2.post1 numba==0.60.0 llvmlite==0.43.0 pillow fonttools brotli faster-whisper==1.2.1
  else
    "$PY312" -m venv "$V"
    "$V/bin/pip" install -q numpy==2.0.2 scipy soundfile librosa==0.10.2.post1 numba==0.60.0 llvmlite==0.43.0 pillow fonttools brotli faster-whisper==1.2.1
  fi
fi
echo "$V/bin/python"

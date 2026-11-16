#!/bin/sh
# Instala un motor de audio local de Andoo (idempotente: si ya está, solo lo verifica).
#   sh motion/audio-local/install.sh kokoro|chatterbox|acestep|stableaudio
# Todo vive por máquina en ~/.cache/creator-studio (o $CREATOR_STUDIO_CACHE):
#   envs/<motor>/      entorno de Python propio de cada motor (uv venv)
#   kokoro/            modelos de Kokoro (kokoro-v1.0.onnx + voices-v1.0.bin)
#   ace-step/          clon del repositorio ACE-Step 1.5
#   hf/                caché de Hugging Face (modelos de Chatterbox, ACE-Step y Stable Audio)
# Stable Audio Open Small necesita la variable HF_TOKEN (token de Hugging Face con la licencia aceptada).
# Códigos de salida: 0 listo · 1 error · 2 uso incorrecto · 3 no compatible con esta máquina.
set -eu

ENGINE="${1:-}"
ROOT="${CREATOR_STUDIO_CACHE:-$HOME/.cache/creator-studio}"
ENVS="$ROOT/envs"
export HF_HOME="$ROOT/hf"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p "$ENVS" "$HF_HOME"

say_() { echo "$*"; }
fail() { echo "ERROR: $1" >&2; exit "${2:-1}"; }

case "$ENGINE" in kokoro|chatterbox|acestep|stableaudio) ;; *) fail "Motor desconocido: '$ENGINE'. Usa kokoro, chatterbox, acestep o stableaudio." 2 ;; esac

# ---------------------------------------------------------------- compatibilidad
OS="$(uname -s)"; ARCH="$(uname -m)"
ACCEL=cpu
if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then ACCEL=apple-silicon
elif command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then ACCEL=cuda; fi

if [ "$ENGINE" != "kokoro" ] && [ "$ACCEL" = "cpu" ]; then
  if [ "$OS" = "Darwin" ]; then
    fail "$ENGINE no es compatible con este Mac Intel: PyTorch ya no publica versiones para macOS x86_64. Funciona en Mac con Apple Silicon (M1 o superior) o en equipos con GPU NVIDIA. Usa Kokoro para la voz; la música se sintetiza." 3
  fi
  fail "$ENGINE necesita una GPU (Apple Silicon o NVIDIA con CUDA) y no se detectó ninguna en este equipo." 3
fi

command -v uv >/dev/null 2>&1 || fail "Falta uv (gestor de Python). Instálalo con: curl -LsSf https://astral.sh/uv/install.sh | sh"
PY312="$(command -v python3.12 || ls /opt/homebrew/opt/python@3.12/bin/python3.12 /usr/local/opt/python@3.12/bin/python3.12 2>/dev/null | head -1 || true)"
PYSPEC="${PY312:-3.12}"   # sin python3.12 en el sistema, uv descarga uno

mkenv() { # $1 = carpeta del entorno
  if [ ! -x "$1/bin/python" ]; then
    say_ "Creando entorno de Python en $1…"
    uv venv -q --python "$PYSPEC" "$1"
  fi
}
# has_mods <carpeta del entorno> <módulo>…: 0 si todos los módulos se pueden importar
has_mods() { E="$1"; shift; "$E/bin/python" -I -c "import importlib.util,sys; sys.exit(0 if all(importlib.util.find_spec(m) for m in sys.argv[1:]) else 1)" "$@" 2>/dev/null; }

download() { # $1 url, $2 destino
  if [ -s "$2" ]; then return 0; fi
  say_ "Descargando $(basename "$2")…"
  curl -fL --retry 3 --progress-bar -o "$2.part" "$1"
  mv "$2.part" "$2"
}

# ---------------------------------------------------------------- motores
case "$ENGINE" in
kokoro)
  E="$ENVS/kokoro"; M="$ROOT/kokoro"; mkdir -p "$M"
  mkenv "$E"
  if ! has_mods "$E" kokoro_onnx soundfile; then
    say_ "Instalando kokoro-onnx (onnxruntime, sin PyTorch)…"
    uv pip install -q --python "$E/bin/python" kokoro-onnx soundfile
  fi
  REL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
  download "$REL/kokoro-v1.0.onnx" "$M/kokoro-v1.0.onnx"
  download "$REL/voices-v1.0.bin" "$M/voices-v1.0.bin"
  has_mods "$E" kokoro_onnx soundfile || fail "kokoro-onnx no quedó instalado en $E."
  ;;

chatterbox)
  E="$ENVS/chatterbox"
  # Chatterbox se probó con Python 3.11; si está disponible se usa, si no 3.12.
  PY311="$(command -v python3.11 || true)"; [ -n "$PY311" ] && PYSPEC="$PY311"
  mkenv "$E"
  if ! has_mods "$E" chatterbox soundfile; then
    say_ "Instalando chatterbox-tts (incluye PyTorch, varios GB)…"
    uv pip install -q --python "$E/bin/python" chatterbox-tts soundfile
  fi
  has_mods "$E" chatterbox soundfile || fail "chatterbox-tts no quedó instalado en $E."
  say_ "Nota: la primera voz generada descarga el modelo de Chatterbox (~2 GB) a $HF_HOME."
  ;;

acestep)
  E="$ENVS/acestep"; R="$ROOT/ace-step"
  command -v git >/dev/null 2>&1 || fail "Falta git para clonar ACE-Step."
  if [ ! -d "$R/.git" ]; then
    say_ "Clonando ACE-Step 1.5…"
    git clone --depth 1 https://github.com/ACE-Step/ACE-Step-1.5.git "$R"
  fi
  if ! { [ -x "$E/bin/python" ] && has_mods "$E" acestep soundfile; }; then
    say_ "Instalando ACE-Step 1.5 con uv sync (PyTorch y dependencias, varios GB)…"
    ( cd "$R" && UV_PROJECT_ENVIRONMENT="$E" uv sync --python "$PYSPEC" )
    has_mods "$E" soundfile || uv pip install -q --python "$E/bin/python" soundfile
  fi
  has_mods "$E" acestep || fail "ACE-Step no quedó instalado en $E."
  say_ "Nota: la primera canción descarga los modelos de ACE-Step (~5 GB) dentro de $R/checkpoints."
  ;;

stableaudio)
  E="$ENVS/stableaudio"
  [ -n "${HF_TOKEN:-}" ] || fail "Stable Audio Open necesita un token de Hugging Face: acepta la licencia en huggingface.co/stabilityai/stable-audio-open-small y pega tu token en Ajustes."
  mkenv "$E"
  if ! has_mods "$E" stable_audio_tools soundfile; then
    say_ "Instalando stable-audio-tools (incluye PyTorch, varios GB)…"
    uv pip install -q --python "$E/bin/python" stable-audio-tools soundfile
  fi
  has_mods "$E" stable_audio_tools || fail "stable-audio-tools no quedó instalado en $E."
  say_ "Descargando Stable Audio Open Small con tu token…"
  "$E/bin/python" -I -c "
import os
from huggingface_hub import snapshot_download
snapshot_download('stabilityai/stable-audio-open-small', token=os.environ['HF_TOKEN'])
" || fail "No se pudo descargar el modelo. Revisa que aceptaste la licencia de stabilityai/stable-audio-open-small con la misma cuenta del token."
  date > "$HF_HOME/.stableaudio-ok"
  ;;
esac

say_ "OK: $ENGINE instalado."

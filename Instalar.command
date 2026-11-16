#!/bin/zsh
# Instalador de Andoo CreatorStudio para macOS. Recomendado: Mac con Apple Silicon y macOS 15 o superior.
# Doble clic, o en Terminal:  ./Instalar.command
# Es seguro ejecutarlo varias veces: solo instala lo que falta.
set -e
cd "$(dirname "$0")"
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" 2>/dev/null || true
eval "$(/usr/local/bin/brew shellenv 2>/dev/null)" 2>/dev/null || true

ok()   { print -P "%F{green}✓%f $1"; }
step() { print -P "\n%F{yellow}▸%f $1"; }

print -P "%BAndoo CreatorStudio — instalación%b"

# 0) Compatibilidad: Homebrew solo trae binarios listos para Apple Silicon con macOS 15+.
ARCH=$(uname -m); OSMAJOR=$(sw_vers -productVersion | cut -d. -f1)
if [ "$ARCH" != "arm64" ] || [ "$OSMAJOR" -lt 15 ]; then
  print -P "%F{yellow}Aviso:%f esta Mac es $ARCH con macOS $(sw_vers -productVersion)."
  print "Homebrew tendrá que COMPILAR node y ffmpeg desde código: puede tardar horas y fallar."
  print "Lo ideal es una Mac con Apple Silicon y macOS 15 o superior."
  read "RESP?¿Continuar de todas formas? (s/n) "
  [[ "$RESP" == [sSyY]* ]] || { print "Instalación cancelada."; exit 1; }
fi

# 1) Homebrew (gestor de paquetes de macOS)
if ! command -v brew >/dev/null 2>&1; then
  print -P "%F{red}Falta Homebrew.%f Instálalo pegando en Terminal el comando de https://brew.sh"
  print "y vuelve a abrir este instalador."
  open "https://brew.sh"
  exit 1
fi
ok "Homebrew"

# 2) Node.js 22.18 o superior (ejecuta TypeScript directo y trae SQLite integrado)
step "Node.js"
if command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  ok "Node $(node -v)"
else
  brew install node
  ok "Node $(node -v)"
fi

# 3) ffmpeg y yt-dlp
step "ffmpeg y yt-dlp"
for pkg in ffmpeg yt-dlp; do
  if command -v $pkg >/dev/null 2>&1; then ok "$pkg"; else brew install $pkg && ok "$pkg"; fi
done

# 4) whisper.cpp (transcripción local)
step "whisper (transcripción)"
build_whisper_from_source() {
  brew list cmake >/dev/null 2>&1 || brew install cmake
  mkdir -p ~/.local/src ~/.local/bin
  [ -d ~/.local/src/whisper.cpp ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git ~/.local/src/whisper.cpp
  (cd ~/.local/src/whisper.cpp && cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF >/dev/null \
    && cmake --build build -j 4 --config Release --target whisper-cli >/dev/null)
  ln -sf ~/.local/src/whisper.cpp/build/bin/whisper-cli ~/.local/bin/whisper-cli
}
export PATH="$HOME/.local/bin:$PATH"
if command -v whisper-cli >/dev/null 2>&1; then
  ok "whisper-cli"
elif [ "$(uname -m)" = "arm64" ]; then
  # En Apple Silicon Homebrew trae binario listo; si falla, se compila (≈2 min)
  brew install whisper-cpp || build_whisper_from_source
  ok "whisper-cli"
else
  # En Intel Homebrew intenta compilar dependencias enormes: compilar whisper directo es mucho más rápido
  print "Compilando whisper.cpp (≈2-3 min)…"
  build_whisper_from_source
  ok "whisper-cli"
fi

# 5) Modelo de voz en español (≈480 MB, una sola vez)
step "Modelo de transcripción"
mkdir -p ~/.cache/whisper
if [ -s ~/.cache/whisper/ggml-small.bin ]; then
  ok "ggml-small.bin"
else
  curl -L --fail --progress-bar -o ~/.cache/whisper/ggml-small.bin.part https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
  mv ~/.cache/whisper/ggml-small.bin.part ~/.cache/whisper/ggml-small.bin
  ok "ggml-small.bin"
fi

# 6) Motor de video: Python 3.12 (librosa, faster-whisper…) y Chromium para el render
step "Motor de video"
command -v python3.12 >/dev/null 2>&1 || ls /opt/homebrew/opt/python@3.12/bin/python3.12 /usr/local/opt/python@3.12/bin/python3.12 >/dev/null 2>&1 || brew install python@3.12
command -v uv >/dev/null 2>&1 || brew install uv
print "Preparando el entorno de audio del motor (la primera vez tarda 1-2 min)…"
sh motion/scripts/pyenv.sh >/dev/null && ok "Entorno Python del motor"

# 6b) Modelo de faster-whisper que usa motion/scripts/words.py (por defecto "small", ≈480 MB, una sola vez) en la caché
# de Hugging Face (~/.cache/huggingface): así el motor transcribe sin red. Para descargar también otros tamaños:
#   STUDIO_WHISPER_MODELS="small medium" ./Instalar.command
step "Modelo de subtítulos del motor"
for WM in ${=${STUDIO_WHISPER_MODELS:-small}}; do
  if motion/.venv/bin/python -I -c "import sys; from faster_whisper import download_model; download_model(sys.argv[1], local_files_only=True)" "$WM" >/dev/null 2>&1; then
    ok "faster-whisper $WM (ya descargado)"
  else
    print "Descargando el modelo faster-whisper \"$WM\" (una sola vez)…"
    motion/.venv/bin/python -I -c "import sys; from faster_whisper import download_model; download_model(sys.argv[1])" "$WM" >/dev/null \
      && ok "faster-whisper $WM"
  fi
done

# 7) Dependencias de la app
step "Dependencias de la app"
# npm ci instala exactamente las versiones del repositorio y nunca modifica package-lock.json
npm ci --no-audit --no-fund >/dev/null
npx playwright install chromium >/dev/null && ok "Chromium para el render"
npm run build >/dev/null
mkdir -p data
chmod +x "Abrir Andoo.command" "Abrir Studio.command" "Actualizar.command" 2>/dev/null || true
ok "Listo"

print -P "\n%BInstalación completa.%b Abriendo Andoo…"
print "Primeros pasos: Ajustes → pega tu clave de IA (Claude u OpenAI) → Marca → crea tu guía."
"./Abrir Andoo.command"

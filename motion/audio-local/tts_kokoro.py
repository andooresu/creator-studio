# Voz local con Kokoro (kokoro-onnx: onnxruntime, sin PyTorch; funciona en CPU, incluso Mac Intel).
# Entrada: JSON por stdin {text, voice, out, model, voices, speed?, lang?}. Escribe un wav a la frecuencia nativa (24 kHz);
# el servidor lo convierte a 48 kHz. Última línea de stdout: RESULT {"path":..., "seconds":..., "sr":...}
import json, sys

args = json.load(sys.stdin)
text = str(args.get("text") or "").strip()
if not text:
    sys.exit("Falta el texto a locutar.")
import soundfile as sf
from kokoro_onnx import Kokoro

kokoro = Kokoro(args["model"], args["voices"])
voice = args.get("voice") or "em_alex"
if voice not in kokoro.get_voices():
    sys.exit(f"La voz '{voice}' no existe en Kokoro. Voces en español: ef_dora, em_alex, em_santa.")
samples, sr = kokoro.create(text, voice=voice, speed=float(args.get("speed") or 1.0), lang=args.get("lang") or "es")
sf.write(args["out"], samples, sr)
print("RESULT " + json.dumps({"path": args["out"], "seconds": round(len(samples) / sr, 3), "sr": sr}))

# Voz local con Chatterbox Multilingual (PyTorch; Apple Silicon/MPS o NVIDIA/CUDA). Español: language_id "es".
# Clona la voz de una muestra (voice = ruta a un wav/mp3) o usa la voz por defecto si voice está vacío.
# Entrada: JSON por stdin {text, voice?, out, lang?}. Última línea: RESULT {"path":..., "seconds":..., "sr":...}
import json, os, sys

args = json.load(sys.stdin)
text = str(args.get("text") or "").strip()
if not text:
    sys.exit("Falta el texto a locutar.")
import torch
import soundfile as sf
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
kw = {"language_id": args.get("lang") or "es"}
ref = args.get("voice") or ""
if ref:
    if not os.path.isfile(ref):
        sys.exit(f"No encuentro la muestra de voz para clonar: {ref}")
    kw["audio_prompt_path"] = ref
wav = model.generate(text, **kw)
data = wav.detach().cpu().numpy().squeeze()
sf.write(args["out"], data, model.sr)
print("RESULT " + json.dumps({"path": args["out"], "seconds": round(len(data) / model.sr, 3), "sr": model.sr, "device": device}))

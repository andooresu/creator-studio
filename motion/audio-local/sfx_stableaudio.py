# Efectos (o loops cortos) locales con Stable Audio Open Small (stable-audio-tools; modelo con licencia en Hugging Face).
# Entrada: JSON por stdin {prompt, seconds, out}. Máximo ~11 s (límite del modelo Small).
# Última línea: RESULT {"path":..., "seconds":..., "sr":...}
import json, sys

args = json.load(sys.stdin)
prompt = str(args.get("prompt") or "").strip()
if not prompt:
    sys.exit("Falta la descripción del efecto.")
import torch
import soundfile as sf
from einops import rearrange
from stable_audio_tools import get_pretrained_model
from stable_audio_tools.inference.generation import generate_diffusion_cond

device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
model, cfg = get_pretrained_model("stabilityai/stable-audio-open-small")
model = model.to(device)
sr, size = cfg["sample_rate"], cfg["sample_size"]
seconds = max(0.5, min(11.0, float(args.get("seconds") or 3)))
out = generate_diffusion_cond(model, steps=8, conditioning=[{"prompt": prompt, "seconds_total": seconds}],
                              sample_size=size, sampler_type="pingpong", device=device)
out = rearrange(out, "b d n -> d (b n)").to(torch.float32)
out = out / out.abs().max().clamp(min=1e-6)
data = out.clamp(-1, 1).cpu().numpy().T[: int(seconds * sr)]
sf.write(args["out"], data, sr)
print("RESULT " + json.dumps({"path": args["out"], "seconds": round(len(data) / sr, 3), "sr": sr, "device": device}))

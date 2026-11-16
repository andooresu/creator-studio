# Música local con ACE-Step 1.5 (modo instrumental, solo DiT: sin el LM de "thinking").
# API según docs/en/INFERENCE.md del repositorio: AceStepHandler + GenerationParams/GenerationConfig + generate_music.
# Entrada: JSON por stdin {prompt, seconds, out, repo, bpm?}. Última línea: RESULT {"path":..., "seconds":..., "sr":...}
import json, os, shutil, sys, tempfile

args = json.load(sys.stdin)
prompt = str(args.get("prompt") or "").strip()
if not prompt:
    sys.exit("Falta la descripción de la música.")
repo = args["repo"]
sys.path.insert(0, repo)
os.chdir(repo)
import torch
import soundfile as sf
from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
seconds = max(10, min(600, float(args.get("seconds") or 30)))
dit = AceStepHandler()
dit.initialize_service(project_root=repo, config_path="acestep-v15-turbo", device=device)
llm = LLMHandler()  # sin inicializar: thinking=False no usa el LM
p = dict(task_type="text2music", caption=prompt, instrumental=True, duration=seconds, thinking=False,
         use_cot_metas=False, use_cot_caption=False, use_cot_language=False)
if args.get("bpm"):
    p["bpm"] = int(args["bpm"])
params = GenerationParams(**p)
config = GenerationConfig(batch_size=1, audio_format="wav")
tmp = tempfile.mkdtemp(prefix="acestep-")
result = generate_music(dit, llm, params, config, save_dir=tmp)
if not result.success or not result.audios:
    sys.exit(f"ACE-Step no generó audio: {result.error}")
src = result.audios[0]["path"]
shutil.move(src, args["out"])
shutil.rmtree(tmp, ignore_errors=True)
info = sf.info(args["out"])
print("RESULT " + json.dumps({"path": args["out"], "seconds": round(info.duration, 3), "sr": info.samplerate, "device": device}))

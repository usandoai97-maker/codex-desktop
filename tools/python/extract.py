"""Helper de extração usado pelo app Electron (ffmpeg + Whisper).

Comandos (saída sempre JSON no stdout):
  info <video>
  audio <video> [saida.mp3]
  frames <video> [intervalo_s] [pasta]
  contact <pasta> [colunas] [linhas] [saida.jpg]
  transcribe <audio> [idioma]
"""

import sys
import json
import os
import re
import subprocess
import argparse

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG = "ffmpeg"


def out(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)


def run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def cmd_info(args):
    p = run([FFMPEG, "-hide_banner", "-i", args.video])
    text = (p.stderr or "") + (p.stdout or "")
    duration = None
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", text)
    if m:
        duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    res = re.search(r"Video:.*?(\d{3,4})x(\d{3,4})", text)
    fps = re.search(r"([\d.]+)\s*fps", text)
    audio = "Audio:" in text
    out({
        "file": os.path.abspath(args.video),
        "exists": os.path.isfile(args.video),
        "duration_seconds": duration,
        "width": int(res.group(1)) if res else None,
        "height": int(res.group(2)) if res else None,
        "fps": float(fps.group(1)) if fps else None,
        "has_audio": audio,
        "ffmpeg": FFMPEG,
    })


def cmd_audio(args):
    if not os.path.isfile(args.video):
        out({"ok": False, "error": "Arquivo não encontrado: " + args.video})
    output = args.output or os.path.splitext(args.video)[0] + ".mp3"
    p = run([FFMPEG, "-y", "-i", args.video, "-vn", "-acodec", "libmp3lame",
             "-q:a", "4", output])
    out({"ok": p.returncode == 0, "output": os.path.abspath(output),
         "error": (p.stderr or "")[-500:] if p.returncode else None})


def cmd_frames(args):
    if not os.path.isfile(args.video):
        out({"ok": False, "error": "Arquivo não encontrado: " + args.video})
    folder = args.folder or os.path.join(os.path.dirname(os.path.abspath(args.video)), "quadros")
    os.makedirs(folder, exist_ok=True)
    pattern = os.path.join(folder, "frame_%03d.jpg")
    p = run([FFMPEG, "-y", "-i", args.video, "-vf",
             "fps=1/%s,scale=1280:720:flags=lanczos" % args.interval,
             "-q:v", "3", pattern])
    files = sorted(f for f in os.listdir(folder) if f.startswith("frame_") and f.endswith(".jpg"))
    out({"ok": p.returncode == 0, "folder": os.path.abspath(folder),
         "count": len(files), "files": files[:500],
         "error": (p.stderr or "")[-500:] if p.returncode else None})


def cmd_contact(args):
    folder = args.folder
    if not os.path.isdir(folder):
        out({"ok": False, "error": "Pasta não encontrada: " + folder})
    output = args.output or os.path.join(folder, "contato.jpg")
    vf = "scale=640:360,tile=%dx%d" % (args.cols, args.rows)
    p = run([FFMPEG, "-y", "-framerate", "1", "-start_number", "1",
             "-i", os.path.join(folder, "frame_%03d.jpg"), "-vf", vf,
             "-frames:v", "1", "-update", "1", output])
    out({"ok": p.returncode == 0 and os.path.isfile(output),
         "output": os.path.abspath(output),
         "error": (p.stderr or "")[-500:] if p.returncode else None})


def cmd_transcribe(args):
    if not os.path.isfile(args.audio):
        out({"ok": False, "error": "Arquivo não encontrado: " + args.audio})
    try:
        import av
        _open = av.open
        def _compat(*a, **kw):
            kw.pop("metadata_errors", None)
            return _open(*a, **kw)
        av.open = _compat
        from faster_whisper import WhisperModel
    except Exception as e:
        out({"ok": False, "error": "faster-whisper indisponível: %s" % e})

    try:
        model = WhisperModel("base", device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            args.audio,
            language=args.language if args.language != "auto" else None,
            beam_size=5,
            vad_filter=True,
        )
        items = [{"start": round(s.start, 2), "end": round(s.end, 2),
                  "text": s.text.strip()} for s in segments]
        text = "\n".join("[%7.2f] %s" % (i["start"], i["text"]) for i in items)
        base = os.path.splitext(args.audio)[0]
        txt_path = base + ".txt"
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(text)
        out({"ok": True, "language": info.language, "duration": info.duration,
             "segments": len(items), "text": text[:60000],
             "output": os.path.abspath(txt_path)})
    except Exception as e:
        out({"ok": False, "error": str(e)})


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("info"); p.add_argument("video"); p.set_defaults(fn=cmd_info)
    p = sub.add_parser("audio"); p.add_argument("video"); p.add_argument("output", nargs="?"); p.set_defaults(fn=cmd_audio)
    p = sub.add_parser("frames"); p.add_argument("video"); p.add_argument("interval", type=int, nargs="?", default=60); p.add_argument("folder", nargs="?"); p.set_defaults(fn=cmd_frames)
    p = sub.add_parser("contact"); p.add_argument("folder"); p.add_argument("cols", type=int, nargs="?", default=3); p.add_argument("rows", type=int, nargs="?", default=6); p.add_argument("output", nargs="?"); p.set_defaults(fn=cmd_contact)
    p = sub.add_parser("transcribe"); p.add_argument("audio"); p.add_argument("language", nargs="?", default="pt"); p.set_defaults(fn=cmd_transcribe)

    args = parser.parse_args()
    try:
        args.fn(args)
    except Exception as e:
        out({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()

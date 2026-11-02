"""Package actual CUA Chrome captures; never synthesize movement between screenshots.

Usage: python3 tools/package_motion_starter_previews.py CAPTURE_DIRECTORY
The directory contains <id>.png and recordings/<id>/{0000.jpg,...,times.json}.
times.json is an ordered list of capture timestamps in seconds. Frames retain their
original elapsed timing, sampled to 24 fps; short recordings hold their final frame.
Requires Pillow, ffmpeg and ffprobe. Does not open or automate a browser.
"""

import argparse
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
IDS = ("aural-object", "current-studio", "nightjar-film")
DURATION = 6.0
FPS = 24


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def quote(path):
    """Escape a filename for ffmpeg's concat demuxer, not for a shell."""
    return "'" + str(path).replace("'", "'\\''") + "'"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_webp(source, target, size, budget):
    with Image.open(source) as image:
        image = ImageOps.fit(image.convert("RGB"), size, Image.Resampling.LANCZOS, centering=(0.5, 0))
        for quality in (82, 76, 70, 64, 58, 52):
            image.save(target, quality=quality, method=6)
            if target.stat().st_size <= budget:
                return
    raise ValueError(f"Cannot meet WebP size budget: {target.name}")


def recording_manifest(recording, output):
    timestamps_path = recording / "times.json"
    timestamps = json.loads(timestamps_path.read_text())
    if not timestamps or not all(isinstance(t, (int, float)) and math.isfinite(t) for t in timestamps):
        raise ValueError(f"Invalid capture timestamps: {timestamps_path}")
    if any(right <= left for left, right in zip(timestamps, timestamps[1:])):
        raise ValueError(f"Capture timestamps must increase: {timestamps_path}")
    frames = [recording / f"{i:04d}.jpg" for i in range(len(timestamps))]
    if any(not frame.is_file() for frame in frames):
        raise ValueError(f"Missing captured frame in {recording}")
    elapsed = [t - timestamps[0] for t in timestamps]
    selected = [(frame, t) for frame, t in zip(frames, elapsed) if t < DURATION]
    lines = ["ffconcat version 1.0"]
    for i, (frame, start) in enumerate(selected):
        end = selected[i + 1][1] if i + 1 < len(selected) else DURATION
        # A millisecond input time base avoids the JPEG demuxer's default 25 fps
        # rounding. The final 24 fps sampling only repeats/drops captured images.
        lines.extend((f"file {quote(frame)}", "option framerate 1000", f"duration {end - start:.9f}"))
    lines.extend((f"file {quote(selected[-1][0])}", "option framerate 1000"))
    output.write_text("\n".join(lines) + "\n")
    return {
        "captured_frames": len(frames),
        "used_frames": len(selected),
        "first_capture_timestamp_seconds": timestamps[0],
        "last_capture_timestamp_seconds": timestamps[-1],
        "source_elapsed_seconds": round(elapsed[-1], 6),
        "final_frame_hold_seconds": round(max(0, DURATION - elapsed[-1]), 6),
        "timestamps_sha256": digest(timestamps_path),
        "timing": "Original elapsed timestamps; nearest 24 fps output samples repeat captured frames without interpolation. Final captured frame held to six seconds when necessary.",
    }


def encode_clip(manifest, target):
    for crf in (27, 29, 31, 33, 35, 37, 39):
        run("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(manifest),
            "-vf", "scale=854:480:force_original_aspect_ratio=increase:in_range=pc:out_range=tv,crop=854:480:0:0,setsar=1,fps=24,format=yuv420p,setparams=range=limited",
            "-t", str(DURATION), "-an", "-c:v", "libx264", "-crf", str(crf), "-preset", "slow",
            "-color_range", "tv", "-movflags", "+faststart", str(target))
        if target.stat().st_size <= 400 * 1024:
            break
    else:
        raise ValueError(f"Cannot meet video size budget: {target.name}")
    verify_clip(target, DURATION)


def verify_clip(path, duration):
    metadata = json.loads(run("ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)))
    streams = metadata["streams"]
    assert len(streams) == 1 and streams[0]["codec_type"] == "video", f"Expected silent video: {path}"
    video = streams[0]
    assert video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p"
    assert (video["width"], video["height"], video["sample_aspect_ratio"]) == (854, 480, "1:1")
    assert abs(float(metadata["format"]["duration"]) - duration) < 0.05
    content = path.read_bytes()
    assert content.index(b"moov") < content.index(b"mdat"), "Video must support fast start"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captures", type=Path)
    args = parser.parse_args()
    captures = args.captures.resolve()
    records = []
    clips = []
    with tempfile.TemporaryDirectory(prefix="motion-starter-previews-") as directory:
        staging = Path(directory)
        for template_id in IDS:
            screenshot = captures / f"{template_id}.png"
            card = "site-" + template_id
            thumb = staging / f"tpl-{template_id}.webp"
            poster = staging / f"{card}.webp"
            clip = staging / f"{card}.mp4"
            save_webp(screenshot, thumb, (640, 400), 82 * 1024)
            save_webp(screenshot, poster, (768, 432), 40 * 1024)
            manifest = staging / f"{template_id}.ffconcat"
            timing = recording_manifest(captures / "recordings" / template_id, manifest)
            encode_clip(manifest, clip)
            for source, relative in ((thumb, f"media/website/{thumb.name}"), (poster, f"media/templates/{poster.name}"), (clip, f"media/templates/{clip.name}")):
                target = ROOT / "public" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
                record = dict(path=relative, bytes=target.stat().st_size, sha256=digest(target), card=card,
                              source="website-motion-recording" if source == clip else "website-motion-screenshot",
                              recorded_from=f"/website?template={template_id}")
                if source == clip:
                    record.update(timing)
                    record["recording"] = f"recordings/{template_id}/times.json"
                else:
                    record["screenshot"] = screenshot.name
                    record["screenshot_sha256"] = digest(screenshot)
                records.append(record)
            clips.append(ROOT / "public/media/templates" / clip.name)
            print(json.dumps({"template": template_id, "video_bytes": clip.stat().st_size, "poster_bytes": poster.stat().st_size,
                              "thumbnail_bytes": thumb.stat().st_size, "source_elapsed_seconds": timing["source_elapsed_seconds"],
                              "final_frame_hold_seconds": timing["final_frame_hold_seconds"]}))

        joined = staging / "motion-starters.ffconcat"
        joined.write_text("ffconcat version 1.0\n" + "".join(f"file {quote(path)}\n" for path in clips))
        output = captures / "motion-starters.mp4"
        run("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(joined), "-c", "copy", "-movflags", "+faststart", str(output))
        verify_clip(output, DURATION * len(IDS))

    # Read after encoding so unrelated provenance additions are retained.
    provenance = ROOT / "public/media/templates/provenance.json"
    data = json.loads(provenance.read_text())
    data["date"] = date.today().isoformat()
    data["sources"]["website-motion-recording"] = (
        "Real Chrome screen recordings captured through CUA from Chucksi's rendered Aural, Current, and Nightjar template pages. "
        "Ordered JPEG frames use their original times.json elapsed timestamps in ffmpeg concat durations, sampled at 24 fps without motion interpolation, "
        "panning, zooming, reversing, or speed changes. Recordings shorter than six seconds hold the last actual captured frame; per-file timing records show the hold. "
        "Static top-aligned crop to 854x480, square pixels, silent H.264 and faststart. Packaged by tools/package_motion_starter_previews.py."
    )
    data["sources"]["website-motion-screenshot"] = (
        "Actual desktop Chrome screenshots of Chucksi's own Aural, Current, and Nightjar template pages, captured through CUA. "
        "Static top-aligned crops and Lanczos resizing only: 640x400 template thumbnails and 768x432 workflow posters. "
        "Packaged by tools/package_motion_starter_previews.py; screenshot hashes are recorded per file."
    )
    replacements = {record["path"] for record in records}
    data["files"] = [record for record in data["files"] if record["path"] not in replacements] + records
    provenance.write_text(json.dumps(data, indent=1) + "\n")
    print(f"Combined real-capture previews: {output}")


if __name__ == "__main__":
    main()
